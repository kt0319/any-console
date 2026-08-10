# Agent screen manifests

[ogulcancelik/herdr](https://github.com/ogulcancelik/herdr)（Apache-2.0）の
`src/detect/manifests/` からベンダリングしたエージェント検知ルール（全エージェント分）。
可視ペイン内容から既知エージェントの状態（blocked = 承認・入力待ち等）を
判定するために `server/src/screen_manifest.rs` が読み込む。

- ライセンス: 同梱の `LICENSE`（Apache License 2.0）を参照
- ここにあるのは**同梱（bundled）階層**。実際の解決は herdr と同じ 3 階層:
  1. ローカル override: `data/agent-detection/<id>.toml`（手動で置く。id が一致すれば最優先）
  2. リモートキャッシュ: `data/agent-detection/remote/<id>.toml`
     （`server/src/manifest_update.rs` が herdr.dev のカタログから取得・検証して保存。
     同梱よりバージョンが古いものは無視される）
  3. 同梱: このディレクトリ
- リモート更新は起動 5 分後 + 24 時間ごと。`config.json` の
  `__global__.agent_detection.remote_update: false` で無効化、
  カタログ URL は環境変数 `ANY_CONSOLE_MANIFEST_CATALOG_URL` で差し替え可能。
  結果は `data/agent-detection/status.json` に記録される
- 同梱分の upstream 同期はリリース時に手動で行う（各 TOML の `version` /
  `updated_at` で差分を確認する）
- 取り込み時の注意: ルールの正規表現は Rust regex 構文。`\x{..}` / `\u{..}` /
  `\p{Alphabetic}` は Rust `regex` クレートがネイティブ対応するため変換不要。
  未対応の構文が増えた場合は `server/src/screen_manifest.rs` の
  `all_bundled_manifests_load_without_duplicate_ids`（バンドル検証テスト。
  全ファイルロード確認）で検出する
