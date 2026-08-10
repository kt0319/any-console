//! `any-console-server --version` / `-V` の統合テスト。
//!
//! サーバを一切起動せず即終了し、CARGO_PKG_VERSION とビルド時埋め込みの
//! git SHA を含む1行を stdout に出すことを確認する（バイナリ単体の
//! smoke test にも使う値なので、フォーマットが回帰しないことをここで担保する）。

use std::process::Command;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_any-console-server")
}

#[test]
fn version_flag_prints_version_and_exits_without_starting_server() {
    let output = Command::new(bin())
        .arg("--version")
        .output()
        .expect("binary should run");
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.starts_with("any-console-server "),
        "unexpected --version output: {stdout}"
    );
    assert!(stdout.contains(env!("CARGO_PKG_VERSION")), "{stdout}");
    // "(<sha>)" の形（sha は "unknown" のこともある — .git 無し環境でのビルド）。
    assert!(stdout.trim_end().ends_with(')'), "{stdout}");
}

#[test]
fn short_version_flag_is_accepted() {
    let output = Command::new(bin())
        .arg("-V")
        .output()
        .expect("binary should run");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("any-console-server "));
}
