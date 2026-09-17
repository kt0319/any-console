//! dispatch-on-ci-failure.yml の疎通確認用。CIをわざと失敗させるだけの一時テスト。
//! 検証後にこのファイルごと削除する。

#[test]
fn force_ci_failure_for_dispatch_verification() {
    panic!("intentional CI failure to verify dispatch-on-ci-failure.yml fires end-to-end (token rotated)");
}
