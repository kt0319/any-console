//! tmux セッション管理（Python 側 `api/tmux.py` の移植）。
//!
//! セッションの作成・アタッチ（PTY 経由）・メタデータ永続化（tmux 環境変数）・
//! ペイン状態の問い合わせを担う。クエリ系コマンドは `subprocess::run_tmux_cmd`
//! （C ロケール強制込み）を再利用する。

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use crate::config::ConfigStore;
use crate::pty::{self, ExecSpec, PtyChild};
use crate::subprocess::{run_tmux_cmd, CmdResult};

pub const TMUX_PANE_READY_TIMEOUT_SEC: f64 = 2.0;
pub const TMUX_PANE_POLL_INTERVAL_SEC: f64 = 0.05;
/// `wait_pane_ready` はシェルプロセスが立ち上がった時点（`pane_current_command`
/// が非空になった時点）で true を返すが、そこから実際にプロンプトが
/// キー入力を受け付けられる状態（rc ファイル読み込み・direnv 等の起動処理）
/// まではもう少しかかることがある。worktree 配下（.envrc 等が重い/初回の
/// direnv allow待ちが挟まる等）でこの差が顕著になり、pane ready 直後に
/// send-keys したジョブ起動コマンドがシェルの起動処理に飲み込まれて
/// ターミナルに反映されない不具合があったため、送信前に一呼吸置く。
pub const TMUX_JOB_LAUNCH_SETTLE_SEC: f64 = 0.3;
pub const TERMINAL_DEFAULT_COLS: u16 = 80;
pub const TERMINAL_DEFAULT_ROWS: u16 = 24;
pub const TERMINAL_TERM_TYPE: &str = "xterm-256color";

/// tmux 環境変数名 → TerminalSession 属性名（永続化する属性を増やす場合は
/// ここと `TMUX_META_ENV_NAMES` の両方に反映する — Python 側の対応コメント参照）。
pub const TMUX_ATTR_ENV_NAMES: &[&str] = &[
    "TMUX_WORKSPACE",
    "TMUX_ICON",
    "TMUX_ICON_COLOR",
    "TMUX_JOB_NAME",
    "TMUX_JOB_LABEL",
    "TMUX_INTERACTIVE",
];

/// `load_tmux_metadata` が読み取る全キー（TMUX_DETACHED・TMUX_PENDING_* は
/// 個別管理のため `TMUX_ATTR_ENV_NAMES` とは別枠）。TMUX_PENDING_TEXT/_ENTER は
/// dispatch（`dispatch.rs`）が新規セッションへ予約するテキストの永続化に使う
/// （プロセスをまたいでも tmux 環境変数経由で安全に受け渡せる）。
const TMUX_META_ENV_NAMES: &[&str] = &[
    "TMUX_WORKSPACE",
    "TMUX_ICON",
    "TMUX_ICON_COLOR",
    "TMUX_JOB_NAME",
    "TMUX_JOB_LABEL",
    "TMUX_INTERACTIVE",
    "TMUX_DETACHED",
    "TMUX_PENDING_TEXT",
    "TMUX_PENDING_ENTER",
];

// ─── hook 用環境変数（Python `agent_hooks.hook_session_env` 相当）─────────────

fn connect_bind_host(host: &str) -> String {
    if matches!(host, "0.0.0.0" | "::" | "") {
        "127.0.0.1".to_string()
    } else {
        host.to_string()
    }
}

/// 実際に Rust サーバが listen しているホスト/ポート（`config.json` の
/// `__global__.host`/`port` に加え、`main.rs` が優先する
/// `ANY_CONSOLE_RS_HOST`/`ANY_CONSOLE_RS_PORT` 環境変数オーバーライドも反映する）。
///
/// hook 用 URL（`ANY_CONSOLE_HOOK_URL`）はこの実効アドレス宛てでなければならない
/// （Codex レビュー指摘: `config.resolve_bind()` だけを見ていると、
/// `ANY_CONSOLE_RS_PORT` で起動ポートを上書きした環境で hook が古い設定ポートへ
/// post してしまい、hooks 由来の状態更新が届かなくなる）。`main.rs` の
/// 起動時アドレス決定ロジックと同じ優先順位をここでも再現する。
pub fn resolve_effective_bind(config: &ConfigStore) -> (String, u16) {
    let (cfg_host, cfg_port) = config.resolve_bind();
    let host = std::env::var("ANY_CONSOLE_RS_HOST")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or(cfg_host);
    let port = std::env::var("ANY_CONSOLE_RS_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(cfg_port);
    (host, port)
}

/// hook 専用トークンを返す（無ければ生成して `data/hook_token` に保存する。
/// Python の `agent_hooks.get_or_create_hook_token` と同一ファイル・同一 best-effort 挙動 —
/// 初回作成時のプロセス間競合はガードしない。0600 で保存する）。
pub(crate) fn get_or_create_hook_token(data_dir: &Path) -> String {
    let path = data_dir.join("hook_token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let token = crate::util::token_urlsafe(24);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::write(&path, format!("{token}\n")).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    token
}

/// tmux セッションへ注入する hook 用環境変数（失敗時は空 — そのセッションでは
/// hooks が無効になるだけでセッション生成自体は妨げない）。
///
fn hook_session_env(
    data_dir: &Path,
    config: &ConfigStore,
    tmux_session_name: &str,
) -> Vec<(String, String)> {
    let (host, port) = resolve_effective_bind(config);
    let host = connect_bind_host(&host);
    vec![
        (
            "ANY_CONSOLE_SESSION".to_string(),
            tmux_session_name.to_string(),
        ),
        (
            "ANY_CONSOLE_HOOK_URL".to_string(),
            format!("http://{host}:{port}/agent-hooks/events"),
        ),
        (
            "ANY_CONSOLE_HOOK_TOKEN".to_string(),
            get_or_create_hook_token(data_dir),
        ),
    ]
}

// ─── セッション作成 ─────────────────────────────────────────────────────────

/// XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS の既定値（`systemd-run --user` に必要）。
fn systemd_user_env_defaults() -> Vec<(String, String)> {
    let uid = unsafe { libc::getuid() };
    let mut extra = Vec::new();
    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        extra.push(("XDG_RUNTIME_DIR".to_string(), format!("/run/user/{uid}")));
    }
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        extra.push((
            "DBUS_SESSION_BUS_ADDRESS".to_string(),
            format!("unix:path=/run/user/{uid}/bus"),
        ));
    }
    extra
}

/// 実体は `subprocess::run_subprocess_with_env` — C ロケール強制を共有する
/// （tmux はクライアントのロケールが UTF-8 でないと出力を壊す。subprocess.rs 参照）。
async fn run_session_cmd(
    program: &str,
    args: &[String],
    cwd: &Path,
    env: &[(String, String)],
    timeout_sec: f64,
) -> bool {
    let mut cmd: Vec<&str> = Vec::with_capacity(args.len() + 1);
    cmd.push(program);
    cmd.extend(args.iter().map(String::as_str));
    crate::subprocess::run_subprocess_with_env(&cmd, timeout_sec, Some(cwd), env)
        .await
        .is_some_and(|r| r.success())
}

/// tmux ベースセッションを作成する（Python `create_tmux_session` 相当）。
/// `systemd-run --user --scope --quiet` 経由を優先し（cgroup 隔離）、失敗時は
/// プレーンな `tmux` 直接実行にフォールバックする。
pub async fn create_tmux_session(
    data_dir: &Path,
    config: &ConfigStore,
    workspace_path: Option<&str>,
    session_name: &str,
) -> std::io::Result<()> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let cwd_buf = match workspace_path {
        Some(p) if Path::new(p).is_dir() => std::path::PathBuf::from(p),
        _ => std::path::PathBuf::from(&home),
    };

    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
    let mut env: Vec<(String, String)> = vec![
        ("TERM".to_string(), TERMINAL_TERM_TYPE.to_string()),
        ("DISPLAY".to_string(), display),
    ];
    if let Some(ws) = workspace_path {
        env.push(("WORKSPACE".to_string(), ws.to_string()));
    }
    env.extend(hook_session_env(data_dir, config, session_name));

    let cols = TERMINAL_DEFAULT_COLS.to_string();
    let rows = TERMINAL_DEFAULT_ROWS.to_string();
    let mut tmux_args: Vec<String> = vec![
        "tmux".to_string(),
        "new-session".to_string(),
        "-d".to_string(),
        "-s".to_string(),
        session_name.to_string(),
    ];
    // `env` の各変数を `-e` で明示的に渡す（プロセス起動時の `.env()` だけでは
    // 既に起動済みの tmux サーバへの新規セッション作成に反映されない —
    // サーバ起動時のクライアント環境がグローバル既定として残り続け、
    // 2 セッション目以降が hook 変数等を引き継げない不具合があった）。
    for (key, value) in &env {
        tmux_args.push("-e".to_string());
        tmux_args.push(format!("{key}={value}"));
    }
    tmux_args.extend(
        [
            "-x",
            &cols,
            "-y",
            &rows,
            &shell,
            ";",
            "set-option",
            "-t",
            session_name,
            "status",
            "off",
            ";",
            "set-option",
            "-t",
            session_name,
            "mouse",
            "off",
            ";",
            "set-option",
            "-t",
            session_name,
            "history-limit",
            "100000",
            ";",
            "set-option",
            "-t",
            session_name,
            "set-clipboard",
            "on",
            ";",
            "set-option",
            "-t",
            session_name,
            "window-size",
            "latest",
        ]
        .iter()
        .map(|s| s.to_string()),
    );

    let mut systemd_env = env.clone();
    systemd_env.extend(systemd_user_env_defaults());
    let mut systemd_args = vec![
        "--user".to_string(),
        "--scope".to_string(),
        "--quiet".to_string(),
    ];
    systemd_args.extend(tmux_args.clone());
    if run_session_cmd(
        "systemd-run",
        &systemd_args,
        &cwd_buf,
        &systemd_env,
        crate::subprocess::TMUX_CMD_TIMEOUT_SEC,
    )
    .await
    {
        return Ok(());
    }
    if run_session_cmd(
        "tmux",
        &tmux_args[1..], // "tmux" 自体は program 側で指定
        &cwd_buf,
        &env,
        crate::subprocess::TMUX_CMD_TIMEOUT_SEC,
    )
    .await
    {
        return Ok(());
    }
    Err(std::io::Error::other(format!(
        "failed to create tmux session={session_name}"
    )))
}

// ─── アタッチ（PTY）───────────────────────────────────────────────────────

/// ベースセッションへ独立した tmux クライアントとして PTY 経由でアタッチする
/// （Python `attach_tmux_session` 相当）。
pub fn attach_tmux_session(session_name: &str, cols: u16, rows: u16) -> std::io::Result<PtyChild> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string());
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let env: Vec<(&str, &str)> = vec![
        ("TERM", TERMINAL_TERM_TYPE),
        ("HOME", home.as_str()),
        ("PATH", path.as_str()),
        ("LANG", lang.as_str()),
        ("SHELL", shell.as_str()),
    ];
    let spec = ExecSpec::resolve("tmux", &["attach-session", "-t", session_name], &env)?;
    pty::spawn(&spec, cols, rows)
}

// ─── クエリ・メタデータ ─────────────────────────────────────────────────────

pub async fn send_keys_to_tmux(session_name: &str, text: &str, enter: bool) -> bool {
    let ok = run_tmux_cmd(&["send-keys", "-t", session_name, "--", text])
        .await
        .is_some_and(|r| r.success());
    if !ok || !enter {
        return ok;
    }
    run_tmux_cmd(&["send-keys", "-t", session_name, "Enter"])
        .await
        .is_some_and(|r| r.success())
}

/// ペインのシェルが起動するまで短時間ポーリングする（ベストエフォート）。
pub async fn wait_pane_ready(session_name: &str, timeout_sec: f64) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs_f64(timeout_sec);
    while tokio::time::Instant::now() < deadline {
        if let Some(r) = run_tmux_cmd(&[
            "display-message",
            "-t",
            session_name,
            "-p",
            "#{pane_current_command}",
        ])
        .await
        {
            if r.success() && !r.stdout.trim().is_empty() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_secs_f64(TMUX_PANE_POLL_INTERVAL_SEC)).await;
    }
    false
}

pub async fn load_tmux_metadata(tmux_name: &str) -> HashMap<String, String> {
    let Some(r) = run_tmux_cmd(&["show-environment", "-t", tmux_name]).await else {
        tracing::warn!("load_tmux_metadata failed session={tmux_name} result=None");
        return HashMap::new();
    };
    if !r.success() {
        tracing::warn!(
            "load_tmux_metadata failed session={tmux_name} returncode={:?}",
            r.code
        );
        return HashMap::new();
    }
    parse_show_environment(&r.stdout, TMUX_META_ENV_NAMES)
}

/// `TMUX_PENDING_TEXT` 専用のエンコード（hex）。`load_tmux_metadata` は
/// `tmux show-environment` の出力を1行1エントリとして `KEY=value` にパースする
/// ため、複数行プロンプト/スクリプトのような改行を含む値をそのまま入れると、
/// 2行目以降が `KEY=` を持たない別行として無視されるか別エントリと誤認され、
/// 承認された text の後半が silently 失われる（Codex レビュー指摘）。改行を
/// 含む任意のテキストを1行の値として安全に運べるよう hex エンコードする。
pub fn encode_pending_text(text: &str) -> String {
    text.bytes().map(|b| format!("{b:02x}")).collect()
}

/// `encode_pending_text` の逆変換。デコードに失敗した場合は空文字列を返す
/// （新規作成された tmux セッションにのみ書き込まれる値のため、通常は必ず
/// 対になった `encode_pending_text` の出力しか読まないが、手動で環境変数を
/// 触られていた場合等の防御として奇形入力を無害化する）。
pub fn decode_pending_text(encoded: &str) -> String {
    if encoded.is_empty() || !encoded.len().is_multiple_of(2) {
        return String::new();
    }
    let bytes: Option<Vec<u8>> = (0..encoded.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16).ok())
        .collect();
    bytes
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}

fn parse_show_environment(stdout: &str, allowed: &[&str]) -> HashMap<String, String> {
    let mut meta = HashMap::new();
    for line in stdout.trim().lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if allowed.contains(&key) {
            meta.insert(key.to_string(), value.to_string());
        }
    }
    meta
}

/// 可視ペインの内容をプレーンテキストで返す（失敗時は None。スクロールバックは含まない）。
pub async fn capture_visible_pane(tmux_name: &str) -> Option<String> {
    let r = run_tmux_cmd(&["capture-pane", "-p", "-t", tmux_name]).await?;
    r.success().then_some(r.stdout)
}

async fn display_message(tmux_name: &str, fmt: &str) -> Option<String> {
    let r = run_tmux_cmd(&["display-message", "-t", tmux_name, "-p", fmt]).await?;
    r.success().then(|| r.stdout.trim().to_string())
}

async fn display_message_int(tmux_name: &str, fmt: &str) -> Option<i64> {
    display_message(tmux_name, fmt).await?.parse().ok()
}

pub async fn get_session_cwd(tmux_name: &str) -> Option<String> {
    display_message(tmux_name, "#{pane_current_path}")
        .await
        .filter(|s| !s.is_empty())
}

/// ペインのカレントディレクトリから最長前方一致するワークスペース名を返す
/// （Python `detect_workspace_from_tmux` 相当。照合は
/// `git_utils::match_workspace_with_worktree`、worktree配下も判別する）。
pub async fn detect_workspace_from_tmux(config: &ConfigStore, tmux_name: &str) -> Option<String> {
    let pane_path = display_message(tmux_name, "#{pane_current_path}").await;
    match pane_path {
        Some(p) => crate::git_utils::match_workspace_with_worktree(config, &p).await,
        None => {
            tracing::warn!("detect_workspace_from_tmux failed session={tmux_name}");
            None
        }
    }
}

/// 登録済みプレフィックスの tmux セッション名から ID 一覧を返す
/// （`agent_watch` の `_list_session_ids` 相当）。
///
/// `None` はコマンド実行自体の失敗（tmux 不在・タイムアウト等）、
/// `Some(vec![])` は「セッション0件」という正当な結果 —
/// 呼び出し側はこれを区別する必要がある（前者を空扱いすると、一時的な
/// 取得失敗を「セッション消滅」と誤認しうるため）。
pub async fn list_session_ids(tmux_prefix: &str) -> Option<Vec<String>> {
    let r = run_tmux_cmd(&["list-sessions", "-F", "#{session_name}"]).await?;
    if !r.success() {
        return Some(Vec::new());
    }
    let mut ids = Vec::new();
    for line in r.stdout.trim().lines() {
        if let Some(id) = line.trim().strip_prefix(tmux_prefix) {
            if !id.is_empty() {
                ids.push(id.to_string());
            }
        }
    }
    Some(ids)
}

/// `list_pane_meta` の1エントリ: (pane_current_command, pane_title, pane_pid,
/// pane_current_path, (pane_width, pane_height))。
pub type PaneMeta = (String, String, i64, String, (i64, i64));

/// 全 tmux セッションの pane メタ情報を一括で返す（`agent_watch` の
/// `list_pane_meta` 相当）。
///
/// キーはセッション名。ポーリング1周期につき1回だけ呼び、セッション数に
/// 比例した tmux 呼び出しを避ける。本アプリはセッションごとに単一ペインで
/// 運用するため、複数ペインあれば最初のペインを採用する。タイトルはタブを
/// 含みうるため最終列以降をタブ区切りのまま連結する。失敗時は空 dict。
///
/// pane_width/height は agent_watch のリサイズ検知用（アタッチ中クライアントの
/// 端末幅に合わせて tmux がペイン内容を再フローするため、出力に変化が無くても
/// capture-pane の全文がリサイズだけで変わってしまう問題への対策）。
pub async fn list_pane_meta() -> HashMap<String, PaneMeta> {
    let Some(r) = run_tmux_cmd(&[
        "list-panes",
        "-a",
        "-F",
        "#{session_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_current_path}\t#{pane_width}\t#{pane_height}\t#{pane_title}",
    ])
    .await
    else {
        return HashMap::new();
    };
    if !r.success() {
        return HashMap::new();
    }
    let mut meta = HashMap::new();
    for line in r.stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 7 {
            continue;
        }
        let pane_pid: i64 = parts[2].parse().unwrap_or(0);
        let pane_width: i64 = parts[4].parse().unwrap_or(0);
        let pane_height: i64 = parts[5].parse().unwrap_or(0);
        let title = parts[6..].join("\t");
        meta.entry(parts[0].to_string()).or_insert((
            parts[1].to_string(),
            title,
            pane_pid,
            parts[3].to_string(),
            (pane_width, pane_height),
        ));
    }
    meta
}

pub async fn get_window_width(tmux_name: &str) -> Option<i64> {
    display_message_int(tmux_name, "#{window_width}").await
}

pub async fn get_tmux_created(tmux_name: &str) -> Option<i64> {
    display_message_int(tmux_name, "#{session_created}").await
}

/// tmux セッションの環境変数を複数まとめて設定する（`save_metadata` 等の共通化）。
pub async fn set_environment(tmux_name: &str, pairs: &[(&str, &str)]) -> Option<CmdResult> {
    if pairs.is_empty() {
        return None;
    }
    let mut args: Vec<&str> = Vec::new();
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            args.push(";");
        }
        args.extend(["set-environment", "-t", tmux_name, k, v]);
    }
    run_tmux_cmd(&args).await
}

pub async fn unset_environment(tmux_name: &str, key: &str) -> Option<CmdResult> {
    run_tmux_cmd(&["set-environment", "-u", "-t", tmux_name, key]).await
}

/// tmux が使えない環境（CI コンテナ等）でスキップするテスト共用ガード
/// （terminal / agent_watch / terminal_session のテストからも使う）。
#[cfg(test)]
pub fn skip_if_no_tmux() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_show_environment_filters_allowed_keys() {
        let out = "TMUX_WORKSPACE=proj\nTMUX_ICON=star\nOTHER=x\nTMUX_DETACHED=1\n";
        let meta = parse_show_environment(out, TMUX_META_ENV_NAMES);
        assert_eq!(meta.get("TMUX_WORKSPACE"), Some(&"proj".to_string()));
        assert_eq!(meta.get("TMUX_DETACHED"), Some(&"1".to_string()));
        assert!(!meta.contains_key("OTHER"));
    }

    #[test]
    fn pending_text_encode_roundtrips_multiline_text() {
        let text = "line one\nline two\r\nline three\ttabbed";
        let encoded = encode_pending_text(text);
        // hex エンコード済みの値は1行に収まる（show-environment のパースを壊さない）。
        assert!(!encoded.contains('\n'));
        assert_eq!(decode_pending_text(&encoded), text);
    }

    #[test]
    fn pending_text_decode_ignores_malformed_input() {
        assert_eq!(decode_pending_text(""), "");
        assert_eq!(decode_pending_text("not-hex-zz"), "");
        assert_eq!(decode_pending_text("abc"), ""); // 奇数長
    }

    /// `ANY_CONSOLE_RS_HOST`/`ANY_CONSOLE_RS_PORT` を書き換えるため、この crate の
    /// テストの中でこれらの環境変数を触るのはこのテストだけ（他は grep 済み）—
    /// 単体テストは同一プロセス内で並行実行されるため、他のテストと競合しうる
    /// 環境変数はテスト全体でユニークに保つ必要がある。
    #[test]
    fn resolve_effective_bind_prefers_env_override_over_config() {
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        // config.json 未作成 = デフォルト (0.0.0.0, 8888)。
        assert_eq!(
            resolve_effective_bind(&config),
            ("0.0.0.0".to_string(), 8888)
        );

        unsafe {
            std::env::set_var("ANY_CONSOLE_RS_HOST", "127.0.0.1");
            std::env::set_var("ANY_CONSOLE_RS_PORT", "9999");
        }
        assert_eq!(
            resolve_effective_bind(&config),
            ("127.0.0.1".to_string(), 9999)
        );
        unsafe {
            std::env::remove_var("ANY_CONSOLE_RS_HOST");
            std::env::remove_var("ANY_CONSOLE_RS_PORT");
        }
    }

    #[test]
    fn connect_bind_host_maps_wildcards() {
        assert_eq!(connect_bind_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(connect_bind_host("::"), "127.0.0.1");
        assert_eq!(connect_bind_host(""), "127.0.0.1");
        assert_eq!(connect_bind_host("192.168.1.5"), "192.168.1.5");
    }

    #[test]
    fn hook_token_persists_across_calls() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = get_or_create_hook_token(dir.path());
        let t2 = get_or_create_hook_token(dir.path());
        assert_eq!(t1, t2);
        assert!(!t1.is_empty());
    }

    #[test]
    fn hook_session_env_url_scheme_is_http() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let config = ConfigStore::new(dir.path().join("config.json"));

        let env = hook_session_env(&data_dir, &config, "ac-sess");
        let url = env
            .iter()
            .find(|(k, _)| k == "ANY_CONSOLE_HOOK_URL")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert!(url.starts_with("http://"), "expected http://, got {url}");
    }

    #[tokio::test]
    async fn create_attach_and_kill_real_session() {
        if super::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let name = format!("ac-test-{}", crate::util::token_hex(4));

        create_tmux_session(dir.path(), &config, None, &name)
            .await
            .expect("session should be created");
        assert!(crate::subprocess::tmux_session_exists(&name).await);

        set_environment(&name, &[("TMUX_WORKSPACE", "proj"), ("TMUX_ICON", "star")]).await;
        let meta = load_tmux_metadata(&name).await;
        assert_eq!(meta.get("TMUX_WORKSPACE"), Some(&"proj".to_string()));

        assert!(wait_pane_ready(&name, TMUX_PANE_READY_TIMEOUT_SEC).await);
        assert!(send_keys_to_tmux(&name, "echo hi-from-test", true).await);

        let child = attach_tmux_session(&name, 80, 24).expect("attach should succeed");
        let pty = crate::pty::AsyncPty::new(child.master).unwrap();
        let mut buf = [0u8; 4096];
        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline
            && !String::from_utf8_lossy(&collected).contains("hi-from-test")
        {
            if let Ok(Ok(n)) =
                tokio::time::timeout(Duration::from_millis(500), pty.read(&mut buf)).await
            {
                if n == 0 {
                    break;
                }
                collected.extend_from_slice(&buf[..n]);
            }
        }
        assert!(String::from_utf8_lossy(&collected).contains("hi-from-test"));

        crate::pty::close(pty.into_inner(), child.pid);
        crate::subprocess::kill_tmux_by_name(&name).await;
        assert!(!crate::subprocess::tmux_session_exists(&name).await);
    }

    #[tokio::test]
    async fn list_session_ids_and_pane_meta_on_real_session() {
        if super::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let prefix = format!("ac-listtest-{}-", crate::util::token_hex(4));
        let session_id = "s1";
        let name = format!("{prefix}{session_id}");

        create_tmux_session(dir.path(), &config, None, &name)
            .await
            .expect("session should be created");
        assert!(wait_pane_ready(&name, TMUX_PANE_READY_TIMEOUT_SEC).await);

        let ids = list_session_ids(&prefix)
            .await
            .expect("tmux should respond");
        assert_eq!(ids, vec![session_id.to_string()]);

        let meta = list_pane_meta().await;
        let entry = meta
            .get(&name)
            .expect("pane meta should include our session");
        assert!(entry.2 > 0, "pane_pid should be positive: {entry:?}");

        crate::subprocess::kill_tmux_by_name(&name).await;
        let ids_after = list_session_ids(&prefix)
            .await
            .expect("tmux should respond");
        assert!(ids_after.is_empty());
    }

    #[tokio::test]
    async fn list_session_ids_returns_empty_not_none_when_no_sessions_match() {
        if super::skip_if_no_tmux() {
            return;
        }
        let ids = list_session_ids("ac-definitely-nonexistent-prefix-").await;
        assert_eq!(ids, Some(Vec::new()));
    }
}
