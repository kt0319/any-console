//! GitHub CLI 連携 API。
//!
//! `gh` CLI を subprocess で叩き、ワークスペース単位で 30 秒 TTL キャッシュする
//! （Actions/PR ピルの 30 秒ポーリング `GITHUB_POLL_INTERVAL_MS` と同周期にし、
//! 外部 API の呼び出し頻度をポーリング1周あたり最大1回に抑える）。

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::ApiError;
use crate::git_utils::resolve_workspace_path;
use crate::state::AppState;
use crate::subprocess::run_subprocess_safe;

const GITHUB_CLI_TIMEOUT_SEC: f64 = 8.0;
pub(crate) const RUNS_LIST_LIMIT: &str = "15";
pub(crate) const RUNS_JSON_FIELDS: &str =
    "databaseId,displayTitle,status,conclusion,event,headBranch,createdAt,updatedAt,url,workflowName";
const PER_WORKSPACE_TTL_SEC: u64 = 30;
/// 単一state（open/closed）指定時のissue取得件数。
const ISSUES_LIST_LIMIT: usize = 30;
const PULLS_LIST_LIMIT: usize = 30;
/// state=all指定時の取得件数。GitHubIssuesPane.vueはこれを1回だけ取得し
/// open/closedの件数・絞り込みをクライアント側で行うため、issueピル
/// （state=open・ISSUES_LIST_LIMIT件）のopen件数と食い違わないよう、
/// closed issueに埋もれてopenが取りこぼされない程度に十分広く取る。
const ISSUES_LIST_LIMIT_ALL: usize = 200;
/// GraphQL の connection は1ページ最大100件。
const GRAPHQL_PAGE_SIZE: usize = 100;

/// GitHub CLI 応答のワークスペース単位 TTL キャッシュを生成する
/// （AppState.gh_cache）。
pub fn new_gh_cache() -> crate::util::TtlCache<Value> {
    crate::util::TtlCache::new(Duration::from_secs(PER_WORKSPACE_TTL_SEC))
}

/// gh を `--json` 付きで実行しパースする。失敗はすべて None。
pub(crate) async fn run_gh_json(args: &[&str], cwd: &std::path::Path) -> Option<Value> {
    let mut cmd = vec!["gh"];
    cmd.extend_from_slice(args);
    let result = run_subprocess_safe(&cmd, GITHUB_CLI_TIMEOUT_SEC, Some(cwd)).await?;
    if !result.success() {
        tracing::warn!(
            "gh command failed: {:?} stderr={}",
            args,
            result.stderr.trim()
        );
        return None;
    }
    serde_json::from_str(&result.stdout).ok()
}

async fn github_fetch(
    state: &Arc<AppState>,
    name: &str,
    suffix: &str,
    gh_args: &[&str],
    error_message: &str,
) -> Result<Json<Value>, ApiError> {
    github_fetch_with(state, name, suffix, error_message, |ws_path| async move {
        run_gh_json(gh_args, &ws_path).await
    })
    .await
}

async fn github_fetch_with<F, Fut>(
    state: &Arc<AppState>,
    name: &str,
    suffix: &str,
    error_message: &str,
    fetch: F,
) -> Result<Json<Value>, ApiError>
where
    F: FnOnce(std::path::PathBuf) -> Fut,
    Fut: std::future::Future<Output = Option<Value>>,
{
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let cache_key = format!("{name}:{suffix}");
    let data = match state.gh_cache.get(&cache_key) {
        Some(cached) => Some(cached),
        None => {
            let fetched = fetch(ws_path).await;
            if let Some(v) = &fetched {
                state.gh_cache.set(&cache_key, v.clone());
            }
            fetched
        }
    };
    Ok(Json(match data {
        Some(d) => json!({"status": "ok", "data": d}),
        None => json!({"status": "error", "detail": error_message}),
    }))
}

#[derive(Deserialize)]
pub struct IssuesQuery {
    state: Option<String>,
}

/// gh CLI の --state に渡せる値へ絞る（open/closed/all以外は既定のopenへフォールバック）。
fn normalize_issue_state(state: Option<&str>) -> &'static str {
    match state {
        Some("closed") => "closed",
        Some("all") => "all",
        _ => "open",
    }
}

pub async fn list_issues(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(query): Query<IssuesQuery>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let issue_state = normalize_issue_state(query.state.as_deref());
    let limit = if issue_state == "all" {
        ISSUES_LIST_LIMIT_ALL
    } else {
        ISSUES_LIST_LIMIT
    };
    let states = if issue_state == "all" {
        "[OPEN, CLOSED]".to_string()
    } else {
        format!("[{}]", issue_state.to_uppercase())
    };
    github_fetch_with(
        &state,
        &name,
        &format!("issues:{issue_state}"),
        "Failed to fetch issues",
        |ws_path| fetch_graphql_list(GraphqlList::Issues, &states, limit, ws_path),
    )
    .await
}

pub async fn list_pulls(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    github_fetch_with(
        &state,
        &name,
        "pulls",
        "Failed to fetch pull requests",
        |ws_path| {
            fetch_graphql_list(
                GraphqlList::PullRequests,
                "[OPEN]",
                PULLS_LIST_LIMIT,
                ws_path,
            )
        },
    )
    .await
}

#[derive(Clone, Copy)]
enum GraphqlList {
    Issues,
    PullRequests,
}

impl GraphqlList {
    fn connection(self) -> &'static str {
        match self {
            Self::Issues => "issues",
            Self::PullRequests => "pullRequests",
        }
    }

    /// コメント件数は本文を取らず totalCount だけ取る。
    /// （`gh ... --json comments` は各項目の本文配列を丸ごと返し、件数が100件で
    /// 打ち切られる。totalCount ならこの上限も受けない。）
    fn node_fields(self) -> &'static str {
        match self {
            Self::Issues => {
                "number title state createdAt updatedAt author{login} labels(first:20){nodes{name color}} \
                 comments{totalCount}"
            }
            Self::PullRequests => {
                "number title state isDraft headRefName createdAt updatedAt author{login} labels(first:20){nodes{name color}}"
            }
        }
    }

    fn query(self, states: &str) -> String {
        format!(
            "query($owner:String!,$name:String!,$first:Int!,$after:String){{ \
             repository(owner:$owner,name:$name){{ {conn}(first:$first,after:$after,states:{states},orderBy:{{field:CREATED_AT,direction:DESC}}){{ \
             pageInfo{{hasNextPage endCursor}} nodes{{ {fields} }} }} }} }}",
            conn = self.connection(),
            fields = self.node_fields(),
        )
    }
}

/// GraphQL のノードを UI 向けの形へ整える。`gh ... list --json` と同じキー
/// （author.login / labels 配列）に、Issue はコメント件数を加える。
fn normalize_node(node: &Value) -> Value {
    let mut out = json!({
        "number": node["number"],
        "title": node["title"],
        "state": node["state"],
        "author": node["author"],
        "labels": node["labels"]["nodes"],
        "createdAt": node["createdAt"],
        "updatedAt": node["updatedAt"],
    });
    if node.get("comments").is_some() {
        out["commentCount"] = node["comments"]["totalCount"].clone();
    }
    if node.get("headRefName").is_some() {
        out["isDraft"] = node["isDraft"].clone();
        out["headRefName"] = node["headRefName"].clone();
    }
    out
}

/// 1ページ分の応答から (整形済みノード, 次ページカーソル) を取り出す。
fn parse_graphql_page(response: &Value, list: GraphqlList) -> Option<(Vec<Value>, Option<String>)> {
    let connection = response["data"]["repository"].get(list.connection())?;
    let nodes = connection["nodes"].as_array()?;
    let next_cursor = connection["pageInfo"]["hasNextPage"]
        .as_bool()
        .filter(|has_next| *has_next)
        .and_then(|_| connection["pageInfo"]["endCursor"].as_str())
        .map(str::to_string);
    Some((nodes.iter().map(normalize_node).collect(), next_cursor))
}

async fn fetch_graphql_list(
    list: GraphqlList,
    states: &str,
    limit: usize,
    cwd: std::path::PathBuf,
) -> Option<Value> {
    let query_arg = format!("query={}", list.query(states));
    let mut items: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    while items.len() < limit {
        let first = (limit - items.len()).min(GRAPHQL_PAGE_SIZE);
        let mut args: Vec<String> = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}"]
            .map(String::from)
            .into();
        args.extend([
            "-F".into(),
            format!("first={first}"),
            "-f".into(),
            query_arg.clone(),
        ]);
        if let Some(c) = &cursor {
            args.extend(["-f".into(), format!("after={c}")]);
        }
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let response = run_gh_json(&arg_refs, &cwd).await?;
        let (page, next) = parse_graphql_page(&response, list)?;
        items.extend(page);
        match next {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    Some(Value::Array(items))
}

pub async fn list_runs(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    github_fetch(
        &state,
        &name,
        "runs",
        &[
            "run",
            "list",
            "--limit",
            RUNS_LIST_LIMIT,
            "--json",
            RUNS_JSON_FIELDS,
        ],
        "Failed to fetch actions",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(connection: &str, nodes: Value, has_next: bool) -> Value {
        json!({"data": {
            "repository": {connection: {
                "pageInfo": {"hasNextPage": has_next, "endCursor": "CUR"},
                "nodes": nodes,
            }},
        }})
    }

    fn pr_node() -> Value {
        json!({
            "number": 5, "title": "feat", "state": "OPEN", "isDraft": false,
            "headRefName": "feature", "createdAt": "c", "updatedAt": "u",
            "author": {"login": "other"},
            "labels": {"nodes": [{"name": "bug", "color": "fff"}]},
        })
    }

    #[test]
    fn pull_node_has_branch_fields_and_no_counts() {
        let response = page("pullRequests", json!([pr_node()]), false);
        let (items, next) = parse_graphql_page(&response, GraphqlList::PullRequests).unwrap();
        assert!(next.is_none());
        let pr = &items[0];
        assert_eq!(pr["labels"][0]["name"], "bug");
        assert_eq!(pr["headRefName"], "feature");
        assert_eq!(pr["isDraft"], false);
        assert!(pr.get("commentCount").is_none());
        assert!(pr.get("comments").is_none());
    }

    #[test]
    fn issue_node_keeps_comment_count_beyond_100() {
        let node = json!({
            "number": 1, "title": "t", "state": "OPEN", "createdAt": "c", "updatedAt": "u",
            "author": {"login": "x"}, "labels": {"nodes": []},
            "comments": {"totalCount": 130},
        });
        let response = page("issues", json!([node]), false);
        let (items, _) = parse_graphql_page(&response, GraphqlList::Issues).unwrap();
        assert_eq!(items[0]["commentCount"], 130);
        assert!(items[0].get("headRefName").is_none());
    }

    #[test]
    fn next_cursor_only_when_more_pages() {
        let more = page("issues", json!([]), true);
        assert_eq!(
            parse_graphql_page(&more, GraphqlList::Issues).unwrap().1,
            Some("CUR".to_string())
        );
        let last = page("issues", json!([]), false);
        assert!(parse_graphql_page(&last, GraphqlList::Issues)
            .unwrap()
            .1
            .is_none());
    }

    #[test]
    fn malformed_response_is_none() {
        assert!(parse_graphql_page(&json!({"errors": []}), GraphqlList::Issues).is_none());
    }

    #[test]
    fn query_selects_counts_not_bodies() {
        let issues = GraphqlList::Issues.query("[OPEN]");
        assert!(issues.contains("comments{totalCount}"));
        assert!(issues.contains("states:[OPEN]"));
        assert!(!issues.contains("body"));
        let pulls = GraphqlList::PullRequests.query("[OPEN]");
        assert!(!pulls.contains("comments"));
        assert!(!pulls.contains("reviews"));
    }
}
