//! tmux を使うテストを、開発機の tmux サーバから隔離する。
//!
//! lib の単体テスト（`#[cfg(test)]`）と `tests/common` の両方から `#[path]` で読み込むため、
//! std と nix 以外には依存しない。
//!
//! `TMUX_TMPDIR` を専用ディレクトリへ向けるので、子プロセスの tmux はすべて専用サーバに繋がる
//! （呼び出し箇所ごとに `-L` を足す必要がない）。専用サーバには、テストプロセスが生きている間だけ
//! 残る常駐セッションを置く。並列テストが最後のセッションを kill した瞬間にサーバが終了し、
//! 同時の `new-session` が失敗するレースを起こさないため。

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Once;

const TMUX_DIR_PREFIX: &str = "ac-test-tmux-";
const KEEPALIVE_SESSION: &str = "__keepalive";

/// テストプロセスで最初の1回だけ隔離する。tmux を起動する前に必ず通す。
pub fn isolate_tmux_server() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("{TMUX_DIR_PREFIX}{pid}"));
        std::fs::create_dir_all(&dir).expect("create test tmux dir");
        // 他スレッドの環境変数アクセスとは std が排他するため、Rust 側では競合しない。
        // この Once が tmux 子プロセスの起動より前に通る前提で、以降の子は隔離済みの環境を引き継ぐ。
        std::env::set_var("TMUX_TMPDIR", &dir);
        // tmux の中から cargo test を実行しても、外側のサーバへ繋がないようにする。
        std::env::remove_var("TMUX");
        start_keepalive_session(pid, &dir);
    });
}

/// テストプロセスの終了を待つ常駐セッションを起動する。終了を検知したらディレクトリを消し、
/// セッションを終えてサーバを落とす（SIGKILL で落ちた場合も同じ）。
/// default-shell が sh 系でなくても動くよう、`sh -c` を明示する。
fn start_keepalive_session(pid: u32, dir: &Path) {
    let watcher = format!(
        "sh -c 'while kill -0 {pid} 2>/dev/null; do sleep 1; done; rm -rf \"{}\"'",
        dir.display()
    );
    let started = Command::new("tmux")
        .args(["new-session", "-d", "-s", KEEPALIVE_SESSION, &watcher])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match started {
        Ok(status) if status.success() => {}
        // tmux 未導入や起動不可の環境では、tmux を使うテストが各自のガードでスキップされる。
        _ => eprintln!("tmux test isolation: keepalive session was not started"),
    }
}
