# Agent screen manifests

[ogulcancelik/herdr](https://github.com/ogulcancelik/herdr)（Apache-2.0）の
`src/detect/manifests/` からベンダリングしたエージェント検知ルール。
可視ペイン内容から既知エージェントの状態（blocked = 承認・入力待ち等）を
判定するために `api/screen_manifest.py` が読み込む。

- ライセンス: 同梱の `LICENSE`（Apache License 2.0）を参照
- 同期方針: リモート自動更新は行わない。upstream の更新はリリース時に手動で
  取り込む（各 TOML の `version` / `updated_at` で差分を確認する）
- 取り込み時の注意: ルールの正規表現は Rust regex 構文。`\x{...}` エスケープは
  `api/screen_manifest.py` の `translate_rust_regex` がロード時に変換する。
  未対応の構文・リージョンが増えた場合は `tests/test_screen_manifest.py` の
  バンドル検証テストで検出する

| ファイル | upstream バージョン |
|---------|--------------------|
| `claude.toml` | 2026.08.04.1 |
| `codex.toml` | 2026.07.18.1 |
