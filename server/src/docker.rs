//! Docker コンテナ検出（`docker ps` サブプロセス実行、`GET /docker/containers` で返す）。
//!
//! dev server 検出（`preview.rs`）と異なりポート待受ではなく `docker ps` を
//! そのまま叩くだけなので、常時バックグラウンドスキャンは持たない — パネルを
//! 開いている間のポーリング（`GET /docker/containers`）のたびに毎回実行する。
//!
//! ワークスペース紐付けは Docker Compose が自動で付与する
//! `com.docker.compose.project.working_dir` ラベルを使う（compose を使わない
//! `docker run` 単体のコンテナは workspace=None のまま返す）。

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::RequireAuth;
use crate::config::ConfigStore;
use crate::state::AppState;
use crate::subprocess::{run_cmd_safe, SYSTEM_CMD_TIMEOUT_SEC};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DetectedContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    /// `docker ps --format {{.State}}` の生値（running/paused/restarting 等）。
    pub state: String,
    pub workspace: Option<String>,
}

/// タブ区切りの1行1コンテナ。ラベル値はcomposeプロジェクトのみ持つため末尾は空文字になりうる。
const DOCKER_PS_FORMAT: &str =
    "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Label \"com.docker.compose.project.working_dir\"}}";

fn parse_docker_ps_output(stdout: &str) -> Vec<(String, String, String, String, String)> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(5, '\t');
            let id = parts.next()?.to_string();
            let name = parts.next()?.to_string();
            let image = parts.next()?.to_string();
            let state = parts.next()?.to_string();
            let working_dir = parts.next().unwrap_or("").trim().to_string();
            Some((id, name, image, state, working_dir))
        })
        .collect()
}

/// `docker` コマンドが無い・daemonが動いていない環境では空一覧を返す
/// （dev server 検出の `ss`/`lsof` 同様、失敗を握りつぶして機能自体を無効化する）。
pub async fn list_containers(config: &ConfigStore) -> Vec<DetectedContainer> {
    let Some(stdout) = run_cmd_safe(
        &["docker", "ps", "--format", DOCKER_PS_FORMAT],
        SYSTEM_CMD_TIMEOUT_SEC,
        None,
    )
    .await
    else {
        return Vec::new();
    };

    let rows = parse_docker_ps_output(&stdout);
    let mut items = Vec::with_capacity(rows.len());
    for (id, name, image, state, working_dir) in rows {
        let workspace = if working_dir.is_empty() {
            None
        } else {
            crate::git_utils::match_workspace_with_worktree(config, &working_dir).await
        };
        items.push(DetectedContainer {
            id,
            name,
            image,
            state,
            workspace,
        });
    }
    items
}

// ─── HTTP エンドポイント（`GET /docker/containers`）────────────────────────

pub async fn list_detected_containers(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Json<Vec<DetectedContainer>> {
    Json(list_containers(&state.config).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_docker_ps_output_splits_tab_separated_rows() {
        let stdout = "abc123\tweb-1\tnginx:latest\trunning\t/Users/dev/my-app\n\
                       def456\tredis-1\tredis:7\texited\t\n";
        let rows = parse_docker_ps_output(stdout);
        assert_eq!(
            rows,
            vec![
                (
                    "abc123".to_string(),
                    "web-1".to_string(),
                    "nginx:latest".to_string(),
                    "running".to_string(),
                    "/Users/dev/my-app".to_string(),
                ),
                (
                    "def456".to_string(),
                    "redis-1".to_string(),
                    "redis:7".to_string(),
                    "exited".to_string(),
                    String::new(),
                ),
            ]
        );
    }

    #[test]
    fn parse_docker_ps_output_ignores_blank_lines() {
        assert_eq!(parse_docker_ps_output(""), Vec::new());
        assert_eq!(parse_docker_ps_output("\n\n"), Vec::new());
    }
}
