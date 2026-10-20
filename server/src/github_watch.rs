//! GitHub の新着コメント／レビュー／CI 完了の検出。
//!
//! - UI（status stream WS の `watch_github`）が宣言したワークスペースだけを、全接続の
//!   和集合に対してワークスペースあたり 1 系統で `WATCH_INTERVAL_SEC` ごとに取得する。
//!   宣言する接続がゼロになったらポーリングを止める（status_stream.rs と同じ思想）。
//! - 「自分以外・Bot 以外」の投稿を、各投稿の id / createdAt の既読範囲（`PostCursor`）
//!   との比較で確定させ、`github_activity` イベントとして status stream へ流す。
//! - イベントはワークスペースごとの単調増加 `seq` を持ち、直近 `RING_CAPACITY` 件を
//!   リングバッファに保持する。再接続した接続へは `since` 以降を再送する。
//! - 取得に失敗した回は、その取得元のイベントも既読範囲の更新も行わない。

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::git_utils::resolve_workspace_path;
use crate::github::{run_gh_json, RUNS_JSON_FIELDS, RUNS_LIST_LIMIT};
use crate::state::AppState;

/// UI の GITHUB_POLL_INTERVAL_MS（30 秒）と同周期。
const WATCH_INTERVAL_SEC: u64 = 30;
const RING_CAPACITY: usize = 64;
const WATCH_LIST_LIMIT: usize = 30;
/// 1 つの PR／Issue から見るコメント・レビューの件数。ウィンドウの全件が新着なら
/// 取りこぼしがありうるため `overflow` として UI に伝える。
const POSTS_PER_WINDOW: usize = 10;
const REVIEW_COMMENTS_PER_REVIEW: usize = 5;
/// 1 回の `watch_github` で受け付けるワークスペース数の上限。
pub const MAX_WATCHED_WORKSPACES: usize = 32;
const POLL_CONCURRENCY: usize = 4;

#[derive(Debug, Clone)]
struct Post {
    id: String,
    kind: &'static str,
    target: &'static str,
    number: u64,
    title: String,
    author: String,
    author_is_bot: bool,
    created_at: String,
    url: String,
}

/// 1 つの PR／Issue のコメント（またはレビュー）取得ウィンドウ。古い順。
#[derive(Debug)]
struct Window {
    posts: Vec<Post>,
    full: bool,
}

/// 確認済みの最新 createdAt と、その時刻に処理済みの id。
/// 同一秒の複数投稿を取りこぼさないため、時刻が同じものは id で判定する。
#[derive(Debug, Clone, Default, PartialEq)]
struct PostCursor {
    newest: Option<String>,
    seen_at_newest: HashSet<String>,
}

impl PostCursor {
    fn is_new(&self, post: &Post) -> bool {
        match &self.newest {
            None => true,
            Some(newest) => {
                post.created_at > *newest
                    || (post.created_at == *newest && !self.seen_at_newest.contains(&post.id))
            }
        }
    }

    fn advanced<'a>(&self, posts: impl Iterator<Item = &'a Post>) -> PostCursor {
        let posts: Vec<&Post> = posts.collect();
        let Some(max_created) = posts.iter().map(|p| p.created_at.as_str()).max() else {
            return self.clone();
        };
        let mut next = match &self.newest {
            Some(newest) if newest.as_str() >= max_created => self.clone(),
            _ => PostCursor {
                newest: Some(max_created.to_string()),
                seen_at_newest: HashSet::new(),
            },
        };
        let newest = next.newest.clone().unwrap_or_default();
        next.seen_at_newest.extend(
            posts
                .iter()
                .filter(|p| p.created_at == newest)
                .map(|p| p.id.clone()),
        );
        next
    }
}

fn activity_query() -> String {
    let author = "author{login __typename}";
    let comments =
        format!("comments(last:{POSTS_PER_WINDOW}){{nodes{{id createdAt url {author}}}}}");
    let reviews = format!(
        "reviews(last:{POSTS_PER_WINDOW}){{nodes{{id createdAt url state body {author} \
         comments(first:{REVIEW_COMMENTS_PER_REVIEW}){{nodes{{id createdAt url {author}}}}}}}}}"
    );
    format!(
        "query($owner:String!,$name:String!){{ viewer{{login}} repository(owner:$owner,name:$name){{ \
         issues(first:{WATCH_LIST_LIMIT},states:OPEN,orderBy:{{field:UPDATED_AT,direction:DESC}}){{nodes{{number title {comments}}}}} \
         pullRequests(first:{WATCH_LIST_LIMIT},states:OPEN,orderBy:{{field:UPDATED_AT,direction:DESC}}){{nodes{{number title {comments} {reviews}}}}} \
         }} }}"
    )
}

fn author_of(node: &Value) -> (String, bool) {
    match node["author"]["login"].as_str() {
        Some(login) => (
            login.to_string(),
            node["author"]["__typename"].as_str() == Some("Bot"),
        ),
        None => ("ghost".to_string(), false),
    }
}

struct PostContext<'a> {
    target: &'static str,
    number: u64,
    title: &'a str,
}

fn make_post(
    node: &Value,
    kind: &'static str,
    ctx: &PostContext,
    author_node: &Value,
) -> Option<Post> {
    let (author, author_is_bot) = author_of(author_node);
    Some(Post {
        id: node["id"].as_str()?.to_string(),
        kind,
        target: ctx.target,
        number: ctx.number,
        title: ctx.title.to_string(),
        author,
        author_is_bot,
        created_at: node["createdAt"].as_str()?.to_string(),
        url: node["url"].as_str().unwrap_or_default().to_string(),
    })
}

/// 本文もレビュー状態も持たない COMMENTED のレビューは、スレッドへの返信（インライン
/// コメント）が 1 件ずつ作る入れ物にすぎない。レビューとしては数えず、中のコメントを
/// comment として扱う。
fn review_posts(review: &Value, ctx: &PostContext) -> Vec<Post> {
    let state = review["state"].as_str().unwrap_or_default();
    if state == "PENDING" {
        return Vec::new();
    }
    let body_empty = review["body"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .is_empty();
    if state == "COMMENTED" && body_empty {
        return review["comments"]["nodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| make_post(c, "comment", ctx, c))
            .collect();
    }
    make_post(review, "review", ctx, review)
        .into_iter()
        .collect()
}

fn window_of(nodes: Option<&Vec<Value>>, build: impl Fn(&Value) -> Vec<Post>) -> Window {
    let nodes = nodes.map(Vec::as_slice).unwrap_or_default();
    Window {
        posts: nodes.iter().flat_map(build).collect(),
        full: nodes.len() >= POSTS_PER_WINDOW,
    }
}

fn parse_posts(response: &Value) -> Option<(String, Vec<Window>)> {
    let viewer = response["data"]["viewer"]["login"].as_str()?.to_string();
    let repository = response["data"]
        .get("repository")
        .filter(|r| r.is_object())?;
    let mut windows = Vec::new();
    for (connection, target) in [("issues", "issue"), ("pullRequests", "pr")] {
        for node in repository[connection]["nodes"].as_array()? {
            let ctx = PostContext {
                target,
                number: node["number"].as_u64()?,
                title: node["title"].as_str().unwrap_or_default(),
            };
            windows.push(window_of(node["comments"]["nodes"].as_array(), |c| {
                make_post(c, "comment", &ctx, c).into_iter().collect()
            }));
            if target == "pr" {
                windows.push(window_of(node["reviews"]["nodes"].as_array(), |r| {
                    review_posts(r, &ctx)
                }));
            }
        }
    }
    Some((viewer, windows))
}

fn post_item(post: &Post, overflow: bool) -> Value {
    json!({
        "kind": post.kind,
        "target": post.target,
        "number": post.number,
        "title": post.title,
        "author": post.author,
        "createdAt": post.created_at,
        "url": post.url,
        "overflow": overflow,
    })
}

/// 新着を確定させる。自分・Bot の投稿は通知しないが、既読範囲には含めて進める。
fn collect_new_posts(
    cursor: &PostCursor,
    viewer: &str,
    windows: &[Window],
) -> (Vec<(String, Value)>, PostCursor) {
    let mut items = Vec::new();
    for window in windows {
        let overflow = window.full && window.posts.first().is_some_and(|p| cursor.is_new(p));
        for post in &window.posts {
            if cursor.is_new(post) && post.author != viewer && !post.author_is_bot {
                items.push((post.created_at.clone(), post_item(post, overflow)));
            }
        }
    }
    let next = cursor.advanced(windows.iter().flat_map(|w| w.posts.iter()));
    (items, next)
}

fn completed_runs(response: &Value) -> Option<Vec<&Value>> {
    Some(
        response
            .as_array()?
            .iter()
            .filter(|r| r["status"].as_str() == Some("completed") && r["databaseId"].is_i64())
            .collect(),
    )
}

fn run_item(run: &Value) -> Value {
    json!({
        "kind": "run",
        "target": "ci",
        "number": run["databaseId"],
        "title": run["displayTitle"],
        "workflow": run["workflowName"],
        "conclusion": run["conclusion"],
        "branch": run["headBranch"],
        "author": Value::Null,
        "createdAt": run["updatedAt"],
        "url": run["url"],
        "overflow": false,
    })
}

#[derive(Default)]
struct Feed {
    seq: u64,
    ring: VecDeque<(u64, Value)>,
    posts: Option<PostCursor>,
    completed_run_ids: Option<HashSet<i64>>,
}

impl Feed {
    /// 取得結果（失敗は None）を反映し、確定した新着があれば配信する payload を返す。
    /// 取得元ごとに独立しており、失敗した側は既読範囲も進めない。
    fn apply_poll(
        &mut self,
        workspace: &str,
        posts: Option<&Value>,
        runs: Option<&Value>,
    ) -> Option<Value> {
        let mut items: Vec<(String, Value)> = Vec::new();

        if let Some((viewer, windows)) = posts.and_then(parse_posts) {
            let cursor = self.posts.clone();
            match cursor {
                Some(cursor) => {
                    let (new_items, next) = collect_new_posts(&cursor, &viewer, &windows);
                    items.extend(new_items);
                    self.posts = Some(next);
                }
                None => {
                    self.posts = Some(
                        PostCursor::default().advanced(windows.iter().flat_map(|w| w.posts.iter())),
                    );
                }
            }
        }

        if let Some(completed) = runs.and_then(completed_runs) {
            let ids: HashSet<i64> = completed
                .iter()
                .filter_map(|r| r["databaseId"].as_i64())
                .collect();
            if let Some(seen) = &self.completed_run_ids {
                for run in completed.iter().filter(|r| {
                    r["databaseId"]
                        .as_i64()
                        .is_some_and(|id| !seen.contains(&id))
                }) {
                    let at = run["updatedAt"].as_str().unwrap_or_default().to_string();
                    items.push((at, run_item(run)));
                }
            }
            self.completed_run_ids = Some(ids);
        }

        if items.is_empty() {
            return None;
        }
        items.sort_by(|a, b| a.0.cmp(&b.0));
        self.seq += 1;
        let payload = json!({
            "type": "github_activity",
            "workspace": workspace,
            "seq": self.seq,
            "items": items.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        });
        self.ring.push_back((self.seq, payload.clone()));
        while self.ring.len() > RING_CAPACITY {
            self.ring.pop_front();
        }
        Some(payload)
    }

    /// `since` より後のイベント。リングに残っていない（取りこぼし）か、サーバ再起動で
    /// seq が巻き戻っている場合は、通知せず基準を取り直させる reset を返す。
    fn replay_since(&self, workspace: &str, since: u64) -> Vec<Value> {
        if since == self.seq {
            return Vec::new();
        }
        let oldest = self.ring.front().map(|(seq, _)| *seq);
        let lost = since > self.seq || oldest.is_none_or(|o| o > since + 1);
        if lost {
            return vec![json!({
                "type": "github_activity_reset",
                "workspace": workspace,
                "seq": self.seq,
            })];
        }
        self.ring
            .iter()
            .filter(|(seq, _)| *seq > since)
            .map(|(_, payload)| payload.clone())
            .collect()
    }

    fn forget_baseline(&mut self) {
        self.posts = None;
        self.completed_run_ids = None;
    }
}

#[derive(Default)]
struct Inner {
    wanted: HashMap<u64, HashSet<String>>,
    feeds: HashMap<String, Feed>,
}

impl Inner {
    fn active_workspaces(&self) -> HashSet<String> {
        self.wanted.values().flatten().cloned().collect()
    }

    /// 誰も見なくなったワークスペースの基準を捨てる（seq とリングは保持する。
    /// 再開後に seq を巻き戻すと、クライアントの最終 seq と食い違うため）。
    fn forget_inactive(&mut self) {
        let active = self.active_workspaces();
        for (name, feed) in &mut self.feeds {
            if !active.contains(name) {
                feed.forget_baseline();
            }
        }
    }
}

pub struct GithubWatchState {
    inner: Mutex<Inner>,
    task: crate::util::SupervisedTask,
    wake: Notify,
    next_conn_id: AtomicU64,
}

impl GithubWatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            task: crate::util::SupervisedTask::new(),
            wake: Notify::new(),
            next_conn_id: AtomicU64::new(1),
        }
    }

    pub fn next_conn_id(&self) -> u64 {
        self.next_conn_id.fetch_add(1, Ordering::Relaxed)
    }

    /// 接続 `conn` の監視対象を `workspaces` に置き換え、`since` を持つワークスペースの
    /// 取りこぼし分（または reset）をこの接続へ直送する payload として返す。
    pub fn set_watch(
        self: &Arc<Self>,
        state: &Arc<AppState>,
        conn: u64,
        workspaces: Vec<String>,
        since: &HashMap<String, u64>,
    ) -> Vec<Value> {
        let set: HashSet<String> = workspaces
            .into_iter()
            .filter(|w| !w.is_empty())
            .take(MAX_WATCHED_WORKSPACES)
            .collect();
        let mut replay = Vec::new();
        let (any_active, needs_baseline) = {
            let mut inner = self.inner.lock().expect("github watch lock poisoned");
            if set.is_empty() {
                inner.wanted.remove(&conn);
            } else {
                inner.wanted.insert(conn, set.clone());
            }
            inner.forget_inactive();
            for name in &set {
                let feed = inner.feeds.entry(name.clone()).or_default();
                if let Some(since) = since.get(name) {
                    replay.extend(feed.replay_since(name, *since));
                }
            }
            let needs_baseline = set
                .iter()
                .any(|n| inner.feeds.get(n).is_some_and(|f| f.posts.is_none()));
            (!inner.wanted.is_empty(), needs_baseline)
        };
        if any_active {
            let watch = self.clone();
            let state = state.clone();
            self.task.ensure(|| tokio::spawn(poll_loop(state, watch)));
            if needs_baseline {
                self.wake.notify_one();
            }
        } else {
            self.task.stop();
        }
        replay
    }

    pub fn remove_conn(&self, conn: u64) {
        let any_active = {
            let mut inner = self.inner.lock().expect("github watch lock poisoned");
            inner.wanted.remove(&conn);
            inner.forget_inactive();
            !inner.wanted.is_empty()
        };
        if !any_active {
            self.task.stop();
        }
    }

    pub fn is_polling(&self) -> bool {
        self.task.is_running()
    }

    fn active_workspaces(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .inner
            .lock()
            .expect("github watch lock poisoned")
            .active_workspaces()
            .into_iter()
            .collect();
        names.sort();
        names
    }

    /// 取得結果を反映し、新着があれば配信用 payload を返す（購読されていない
    /// ワークスペースは無視）。`poll_workspace` と統合テストが使う。
    pub fn apply_poll(
        &self,
        workspace: &str,
        posts: Option<&Value>,
        runs: Option<&Value>,
    ) -> Option<Value> {
        let mut inner = self.inner.lock().expect("github watch lock poisoned");
        if !inner.active_workspaces().contains(workspace) {
            return None;
        }
        inner
            .feeds
            .get_mut(workspace)?
            .apply_poll(workspace, posts, runs)
    }
}

impl Default for GithubWatchState {
    fn default() -> Self {
        Self::new()
    }
}

async fn fetch_posts(cwd: &Path) -> Option<Value> {
    let query_arg = format!("query={}", activity_query());
    run_gh_json(
        &[
            "api",
            "graphql",
            "-F",
            "owner={owner}",
            "-F",
            "name={repo}",
            "-f",
            &query_arg,
        ],
        cwd,
    )
    .await
}

async fn fetch_runs(cwd: &Path) -> Option<Value> {
    run_gh_json(
        &[
            "run",
            "list",
            "--limit",
            RUNS_LIST_LIMIT,
            "--json",
            RUNS_JSON_FIELDS,
        ],
        cwd,
    )
    .await
}

async fn poll_workspace(state: &Arc<AppState>, workspace: String) {
    let Ok(cwd) = resolve_workspace_path(&state.config, &workspace).await else {
        return;
    };
    let (posts, runs) = tokio::join!(fetch_posts(&cwd), fetch_runs(&cwd));
    if let Some(payload) = state
        .github_watch
        .apply_poll(&workspace, posts.as_ref(), runs.as_ref())
    {
        state.status_stream.broadcast(payload);
    }
}

async fn poll_loop(state: Arc<AppState>, watch: Arc<GithubWatchState>) {
    let mut interval = tokio::time::interval(Duration::from_secs(WATCH_INTERVAL_SEC));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = interval.tick() => {}
            _ = watch.wake.notified() => {}
        }
        futures_util::stream::iter(watch.active_workspaces())
            .for_each_concurrent(POLL_CONCURRENCY, |name| poll_workspace(&state, name))
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comment(id: &str, at: &str, login: &str, typename: &str) -> Value {
        json!({"id": id, "createdAt": at, "url": format!("https://x/{id}"),
               "author": {"login": login, "__typename": typename}})
    }

    fn review(
        id: &str,
        at: &str,
        login: &str,
        state: &str,
        body: &str,
        inline: Vec<Value>,
    ) -> Value {
        json!({"id": id, "createdAt": at, "url": format!("https://x/{id}"), "state": state,
               "body": body, "author": {"login": login, "__typename": "User"},
               "comments": {"nodes": inline}})
    }

    fn response(
        issue_comments: Vec<Value>,
        pr_comments: Vec<Value>,
        pr_reviews: Vec<Value>,
    ) -> Value {
        json!({"data": {"viewer": {"login": "me"}, "repository": {
            "issues": {"nodes": [{"number": 1, "title": "issue", "comments": {"nodes": issue_comments}}]},
            "pullRequests": {"nodes": [{"number": 2, "title": "pr",
                "comments": {"nodes": pr_comments}, "reviews": {"nodes": pr_reviews}}]},
        }}})
    }

    fn runs(list: Vec<(i64, &str)>) -> Value {
        Value::Array(
            list.into_iter()
                .map(|(id, status)| {
                    json!({"databaseId": id, "status": status, "conclusion": "success",
                    "displayTitle": "t", "workflowName": "CI", "headBranch": "main",
                    "updatedAt": format!("2026-01-01T00:00:{id:02}Z"), "url": "u"})
                })
                .collect(),
        )
    }

    fn items(payload: &Option<Value>) -> Vec<Value> {
        payload
            .as_ref()
            .map(|p| p["items"].as_array().cloned().unwrap())
            .unwrap_or_default()
    }

    #[test]
    fn first_poll_records_baseline_without_events() {
        let mut feed = Feed::default();
        let r = response(
            vec![comment("c1", "2026-01-01T00:00:01Z", "alice", "User")],
            vec![],
            vec![],
        );
        assert!(feed
            .apply_poll("ws", Some(&r), Some(&runs(vec![(1, "completed")])))
            .is_none());
        assert_eq!(feed.seq, 0);
    }

    #[test]
    fn classifies_self_bot_and_others() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        let r = response(
            vec![
                comment("a", "2026-01-01T00:00:01Z", "me", "User"),
                comment("b", "2026-01-01T00:00:02Z", "github-actions", "Bot"),
                comment("c", "2026-01-01T00:00:03Z", "alice", "User"),
            ],
            vec![],
            vec![],
        );
        let out = feed.apply_poll("ws", Some(&r), None);
        let got = items(&out);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["author"], "alice");
        assert_eq!(got[0]["target"], "issue");
        assert_eq!(got[0]["kind"], "comment");
        assert_eq!(out.unwrap()["seq"], 1);
    }

    #[test]
    fn same_post_is_not_reported_twice() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        let r = response(
            vec![comment("c", "2026-01-01T00:00:03Z", "alice", "User")],
            vec![],
            vec![],
        );
        assert!(feed.apply_poll("ws", Some(&r), None).is_some());
        assert!(feed.apply_poll("ws", Some(&r), None).is_none());
    }

    #[test]
    fn same_timestamp_different_id_is_still_new() {
        let mut feed = Feed::default();
        let first = response(
            vec![comment("c1", "2026-01-01T00:00:03Z", "alice", "User")],
            vec![],
            vec![],
        );
        feed.apply_poll("ws", Some(&first), None);
        let second = response(
            vec![
                comment("c1", "2026-01-01T00:00:03Z", "alice", "User"),
                comment("c2", "2026-01-01T00:00:03Z", "bob", "User"),
            ],
            vec![],
            vec![],
        );
        let got = items(&feed.apply_poll("ws", Some(&second), None));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["author"], "bob");
    }

    #[test]
    fn own_and_bot_posts_still_advance_the_cursor() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        let own = response(
            vec![comment("a", "2026-01-01T00:00:09Z", "me", "User")],
            vec![],
            vec![],
        );
        assert!(feed.apply_poll("ws", Some(&own), None).is_none());
        let older_other = response(
            vec![
                comment("a", "2026-01-01T00:00:09Z", "me", "User"),
                comment("z", "2026-01-01T00:00:05Z", "alice", "User"),
            ],
            vec![],
            vec![],
        );
        assert!(feed.apply_poll("ws", Some(&older_other), None).is_none());
    }

    #[test]
    fn empty_commented_review_becomes_its_inline_comments() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        let reviews = vec![
            review(
                "r1",
                "2026-01-01T00:00:01Z",
                "alice",
                "COMMENTED",
                "",
                vec![comment("rc1", "2026-01-01T00:00:01Z", "alice", "User")],
            ),
            review("r2", "2026-01-01T00:00:02Z", "bob", "APPROVED", "", vec![]),
            review(
                "r3",
                "2026-01-01T00:00:03Z",
                "carol",
                "COMMENTED",
                "looks off",
                vec![comment("rc3", "2026-01-01T00:00:03Z", "carol", "User")],
            ),
            review("r4", "2026-01-01T00:00:04Z", "dave", "PENDING", "x", vec![]),
        ];
        let got = items(&feed.apply_poll("ws", Some(&response(vec![], vec![], reviews)), None));
        let kinds: Vec<(&str, &str)> = got
            .iter()
            .map(|i| (i["kind"].as_str().unwrap(), i["author"].as_str().unwrap()))
            .collect();
        assert_eq!(
            kinds,
            vec![("comment", "alice"), ("review", "bob"), ("review", "carol")]
        );
        assert!(got.iter().all(|i| i["target"] == "pr" && i["number"] == 2));
    }

    #[test]
    fn full_window_of_new_posts_is_flagged_overflow() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        let many: Vec<Value> = (0..POSTS_PER_WINDOW)
            .map(|i| {
                comment(
                    &format!("c{i}"),
                    &format!("2026-01-01T00:00:{:02}Z", i + 1),
                    "alice",
                    "User",
                )
            })
            .collect();
        let got = items(&feed.apply_poll("ws", Some(&response(many, vec![], vec![])), None));
        assert_eq!(got.len(), POSTS_PER_WINDOW);
        assert!(got.iter().all(|i| i["overflow"] == true));
    }

    #[test]
    fn partially_new_window_is_not_overflow() {
        let mut feed = Feed::default();
        let old: Vec<Value> = (0..POSTS_PER_WINDOW)
            .map(|i| {
                comment(
                    &format!("c{i}"),
                    &format!("2026-01-01T00:00:{:02}Z", i + 1),
                    "alice",
                    "User",
                )
            })
            .collect();
        feed.apply_poll("ws", Some(&response(old.clone(), vec![], vec![])), None);
        let mut next = old[1..].to_vec();
        next.push(comment("new", "2026-01-01T00:01:00Z", "bob", "User"));
        let got = items(&feed.apply_poll("ws", Some(&response(next, vec![], vec![])), None));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["overflow"], false);
    }

    #[test]
    fn failed_fetch_does_not_advance_or_report() {
        let mut feed = Feed::default();
        feed.apply_poll(
            "ws",
            Some(&response(vec![], vec![], vec![])),
            Some(&runs(vec![(1, "completed")])),
        );
        assert!(feed.apply_poll("ws", None, None).is_none());
        assert!(feed
            .apply_poll("ws", Some(&json!({"errors": []})), None)
            .is_none());
        let r = response(
            vec![comment("c", "2026-01-01T00:00:03Z", "alice", "User")],
            vec![],
            vec![],
        );
        assert_eq!(items(&feed.apply_poll("ws", Some(&r), None)).len(), 1);
    }

    #[test]
    fn failed_first_fetch_keeps_baseline_unset() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", None, None);
        assert!(feed.posts.is_none());
        let r = response(
            vec![comment("c", "2026-01-01T00:00:03Z", "alice", "User")],
            vec![],
            vec![],
        );
        assert!(feed.apply_poll("ws", Some(&r), None).is_none());
    }

    #[test]
    fn completed_run_is_reported_once_and_in_progress_is_not() {
        let mut feed = Feed::default();
        feed.apply_poll(
            "ws",
            None,
            Some(&runs(vec![(1, "completed"), (2, "in_progress")])),
        );
        let done = runs(vec![(1, "completed"), (2, "completed")]);
        let got = items(&feed.apply_poll("ws", None, Some(&done)));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["kind"], "run");
        assert_eq!(got[0]["number"], 2);
        assert_eq!(got[0]["conclusion"], "success");
        assert_eq!(got[0]["branch"], "main");
        assert!(feed.apply_poll("ws", None, Some(&done)).is_none());
    }

    #[test]
    fn rerun_of_a_completed_run_is_reported_again() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", None, Some(&runs(vec![(1, "completed")])));
        assert!(feed
            .apply_poll("ws", None, Some(&runs(vec![(1, "in_progress")])))
            .is_none());
        assert_eq!(
            items(&feed.apply_poll("ws", None, Some(&runs(vec![(1, "completed")])))).len(),
            1
        );
    }

    #[test]
    fn seq_is_monotonic_and_replay_returns_only_newer_events() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", Some(&response(vec![], vec![], vec![])), None);
        for i in 1..=3 {
            let c = comment(
                &format!("c{i}"),
                &format!("2026-01-01T00:00:{i:02}Z"),
                "alice",
                "User",
            );
            let list = (1..=i)
                .map(|j| {
                    comment(
                        &format!("c{j}"),
                        &format!("2026-01-01T00:00:{j:02}Z"),
                        "alice",
                        "User",
                    )
                })
                .collect::<Vec<_>>();
            let _ = c;
            assert!(feed
                .apply_poll("ws", Some(&response(list, vec![], vec![])), None)
                .is_some());
        }
        assert_eq!(feed.seq, 3);
        let replay = feed.replay_since("ws", 1);
        assert_eq!(
            replay
                .iter()
                .map(|p| p["seq"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert!(feed.replay_since("ws", 3).is_empty());
    }

    #[test]
    fn replay_resets_when_events_were_evicted_or_seq_went_backwards() {
        let mut feed = Feed {
            seq: (RING_CAPACITY as u64) + 10,
            ..Feed::default()
        };
        for seq in 11..=feed.seq {
            feed.ring
                .push_back((seq, json!({"type": "github_activity", "seq": seq})));
        }
        let evicted = feed.replay_since("ws", 3);
        assert_eq!(evicted[0]["type"], "github_activity_reset");
        assert_eq!(evicted[0]["seq"], feed.seq);
        let rewound = feed.replay_since("ws", feed.seq + 5);
        assert_eq!(rewound[0]["type"], "github_activity_reset");
        let contiguous = feed.replay_since("ws", 10);
        assert_eq!(contiguous.len(), RING_CAPACITY);
    }

    #[test]
    fn ring_is_capped() {
        let mut feed = Feed::default();
        feed.apply_poll("ws", None, Some(&runs(vec![])));
        for i in 1..=(RING_CAPACITY as i64 + 5) {
            feed.apply_poll("ws", None, Some(&runs(vec![(i, "completed")])));
        }
        assert_eq!(feed.ring.len(), RING_CAPACITY);
        assert_eq!(feed.ring.back().unwrap().0, feed.seq);
    }

    #[test]
    fn query_asks_for_ids_authors_and_no_bodies_of_comments() {
        let q = activity_query();
        assert!(q.contains("comments(last:10)"));
        assert!(q.contains("reviews(last:10)"));
        assert!(q.contains("author{login __typename}"));
        assert!(q.contains("states:OPEN"));
    }

    fn watch_state() -> (tempfile::TempDir, Arc<AppState>) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "gw-", 1000));
        (dir, state)
    }

    #[tokio::test]
    async fn polling_runs_only_while_someone_watches() {
        let (_dir, state) = watch_state();
        let watch = Arc::new(GithubWatchState::new());
        let conn = watch.next_conn_id();
        watch.set_watch(&state, conn, vec!["a".into()], &HashMap::new());
        assert!(watch.task.is_running());
        assert_eq!(watch.active_workspaces(), vec!["a".to_string()]);
        watch.remove_conn(conn);
        assert!(!watch.task.is_running());
        assert!(watch.active_workspaces().is_empty());
    }

    #[tokio::test]
    async fn watchers_are_unioned_across_connections() {
        let (_dir, state) = watch_state();
        let watch = Arc::new(GithubWatchState::new());
        let (c1, c2) = (watch.next_conn_id(), watch.next_conn_id());
        watch.set_watch(&state, c1, vec!["a".into(), "b".into()], &HashMap::new());
        watch.set_watch(&state, c2, vec!["b".into()], &HashMap::new());
        assert_eq!(
            watch.active_workspaces(),
            vec!["a".to_string(), "b".to_string()]
        );
        watch.remove_conn(c1);
        assert_eq!(watch.active_workspaces(), vec!["b".to_string()]);
        assert!(watch.task.is_running());
        watch.remove_conn(c2);
        assert!(!watch.task.is_running());
    }

    #[tokio::test]
    async fn baseline_is_dropped_when_nobody_watches_but_seq_continues() {
        let (_dir, state) = watch_state();
        let watch = Arc::new(GithubWatchState::new());
        let conn = watch.next_conn_id();
        watch.set_watch(&state, conn, vec!["a".into()], &HashMap::new());
        watch.apply_poll("a", Some(&response(vec![], vec![], vec![])), None);
        let c = comment("c", "2026-01-01T00:00:01Z", "alice", "User");
        assert!(watch
            .apply_poll("a", Some(&response(vec![c], vec![], vec![])), None)
            .is_some());
        watch.remove_conn(conn);
        watch.set_watch(&state, conn, vec!["a".into()], &HashMap::new());
        let c2 = comment("d", "2026-01-01T00:00:02Z", "alice", "User");
        assert!(watch
            .apply_poll("a", Some(&response(vec![c2.clone()], vec![], vec![])), None)
            .is_none());
        let again = watch.apply_poll(
            "a",
            Some(&response(
                vec![c2, comment("e", "2026-01-01T00:00:03Z", "bob", "User")],
                vec![],
                vec![],
            )),
            None,
        );
        assert_eq!(again.unwrap()["seq"], 2);
        watch.remove_conn(conn);
    }

    #[tokio::test]
    async fn set_watch_replays_missed_events_for_that_connection() {
        let (_dir, state) = watch_state();
        let watch = Arc::new(GithubWatchState::new());
        let c1 = watch.next_conn_id();
        watch.set_watch(&state, c1, vec!["a".into()], &HashMap::new());
        watch.apply_poll("a", Some(&response(vec![], vec![], vec![])), None);
        let r = response(
            vec![comment("c", "2026-01-01T00:00:01Z", "alice", "User")],
            vec![],
            vec![],
        );
        watch.apply_poll("a", Some(&r), None);
        let c2 = watch.next_conn_id();
        let replay = watch.set_watch(
            &state,
            c2,
            vec!["a".into()],
            &HashMap::from([("a".to_string(), 0)]),
        );
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0]["seq"], 1);
        watch.remove_conn(c1);
        watch.remove_conn(c2);
    }

    #[tokio::test]
    async fn events_for_unwatched_workspaces_are_dropped() {
        let watch = GithubWatchState::new();
        assert!(watch
            .apply_poll("a", Some(&response(vec![], vec![], vec![])), None)
            .is_none());
    }
}
