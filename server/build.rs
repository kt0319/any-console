//! `--version` 表示用にビルド時の短縮 git SHA を埋め込む（`main.rs` の
//! `ANY_CONSOLE_GIT_SHA` から参照）。`.git` が無い環境（リリース tarball の
//! 展開先など、実行時のマシン）でのビルドではなく、CI 等 `.git` がある
//! 状態でのビルド時にのみ埋め込まれる。取得できなければ "unknown"。
fn main() {
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=ANY_CONSOLE_GIT_SHA={sha}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
}
