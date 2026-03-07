# アーキテクチャ詳細

CLAUDE.md から分離した参照用ドキュメント。変更時の影響範囲確認に使用する。

## バックエンド: `api/`

- **FastAPI** (Python 3.11+)
- `main.py`: アプリ初期化、ルーターマウント、画像アップロード、静的ファイル配信
- `auth.py`: 環境変数 `PI_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでジョブ実行（タイムアウト120秒）
- `jobs.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）
- `common.py`: 共通定数（パス・タイムアウト・パターン）、`TTLCache`、`LogBuffer`、`BACKGROUND_EXECUTOR`
- `config.py`: `config.json` の読み書き・ロック管理
- `config_schema.py`: Pydanticによるconfig.jsonのスキーマ定義・検証
- `git_utils.py`: Gitコマンド実行ユーティリティ、ブランチ取得、git info キャッシュ

### ルーター: `api/routers/`

- `workspaces.py`: ワークスペース一覧・clone・GitHubリポジトリ一覧・ワークスペース設定
- `git.py`: Git関連サブルーターの結合マウント
- `git_refs.py`: ブランチ操作（checkout、作成、削除）、pull/push/fetch
- `git_history.py`: コミット履歴、cherry-pick、revert、reset
- `git_diff.py`: ワーキングツリーdiff、コミットdiff
- `git_files.py`: ファイルブラウザ、ファイル内容取得
- `git_shared.py`: Git操作の共通ユーティリティ（パス検証・stash ref検証）
- `jobs.py`: ジョブ一覧・作成・更新・削除、リンク管理、ジョブ実行、ターミナルセッション作成
- `terminal.py`: PTYベースのターミナルセッション管理、WebSocket通信
- `settings.py`: 設定インポート/エクスポート
- `system.py`: システム情報・プロセス一覧
- `logs.py`: ネットワークログの取得・クリア・クライアントログ受信、操作ログ（ユーザー操作履歴）の取得・クリア

## フロントエンド: `ui/`

- **バニラJS**（フレームワーク・ビルドステップなし）
- `index.html`: SPAシェル
- 状態はグローバル変数 + LocalStorageで永続化

### 状態・基盤

- `state-core.js`: token・workspaces・タブ・パネル配置などのグローバル状態
- `state-input.js`: ターミナルのキーボード・キー入力データ定義
- `state-git.js`: Git操作用のグローバル状態（diffチャンク・ブランチ作成情報等）
- `logger.js`: クライアントログ送信
- `api-client.js`: API通信共通処理（Bearerトークン付与）
- `cache.js`: LocalStorageキャッシュ管理（ワークスペースメタ・GitHubリポ）
- `utils.js`: ユーティリティ
- `auth.js`: 認証処理（Token保存はLocalStorage+Cookie）
- `bootstrap.js`: アプリ初期化・ワークスペース読み込み・タブ復元
- `viewport.js`: ビューポート高さ監視・キーボード表示判定

### ターミナル

- `terminal.js`: xterm.js統合のWebターミナル
- `terminal-connection.js`: 端末セッション同期
- `terminal-view-mode.js`: ターミナルビューモード切替
- `terminal-split.js`: ターミナル分割表示
- `terminal-tab-pill.js`: タブ名ピルの描画・長押し処理
- `terminal-tabs.js`: タブ管理（追加・削除・切替）
- `terminal-tab-modal.js`: タブモーダル（ワークスペース/設定選択）
- `terminal-tab-modal-workspace.js`: タブモーダルのワークスペースセクション

### Git

- `workspace.js`: ワークスペース一覧・選択
- `git.js`: Git操作UI
- `git-diff.js`: Git差分表示
- `git-file-browser.js`: ファイルブラウザ
- `file-browser-upload.js`: ファイルアップロード・ドラッグ&ドロップ
- `git-log-modal.js`: Git履歴モーダルの状態管理
- `git-log-history.js`: コミット履歴一覧の描画
- `git-log-branch-stash.js`: ブランチ・スタッシュ選択UI

### ジョブ・設定

- `job-form.js`: ジョブ作成・編集フォームUI
- `jobs.js`: ジョブ一覧・実行・確認モーダル
- `settings.js`: 設定モーダル制御、サーバー情報、インポート/エクスポート
- `settings-workspace.js`: ワークスペース設定UI（並び替え・表示/非表示・アイコン）
- `settings-terminal.js`: ターミナル設定UI（フォントサイズ等の全タブ適用）

### UI部品

- `quick-input.js`: 汎用入力UI
- `quick-input-keys.js`: 端末ショートカット・画像アップロード
- `icon-picker.js`: アイコン選択UI

### スタイル

- `styles.css`: CSS変数によるダークテーマ

## 主要API

| エンドポイント | 用途 |
|---|---|
| `GET /auth/check` | 認証確認 |
| `POST /run` | ジョブ実行・ターミナル作成 |
| `GET /workspaces` | ワークスペース一覧 |
| `POST /workspaces` | リポジトリclone |
| `PUT /workspaces/{name}/config` | ワークスペース設定更新 |
| `GET /workspaces/{name}/status` | Git状態 |
| `GET /workspaces/{name}/branches` | ローカルブランチ一覧 |
| `GET /workspaces/{name}/branches/remote` | リモートブランチ一覧 |
| `POST /workspaces/{name}/checkout` | ブランチ切替 |
| `POST /workspaces/{name}/create-branch` | ブランチ作成 |
| `POST /workspaces/{name}/delete-branch` | ブランチ削除 |
| `POST /workspaces/{name}/pull` | git pull --rebase |
| `POST /workspaces/{name}/push` | git push |
| `POST /workspaces/{name}/fetch` | git fetch --prune |
| `GET /workspaces/{name}/git-log` | コミット履歴 |
| `POST /workspaces/{name}/commit` | git commit |
| `POST /workspaces/{name}/cherry-pick` | cherry-pick |
| `POST /workspaces/{name}/revert` | revert |
| `POST /workspaces/{name}/reset` | reset (soft/hard) |
| `GET /workspaces/{name}/diff` | ワーキングツリーdiff |
| `GET /workspaces/{name}/diff/{hash}` | コミットdiff |
| `GET /workspaces/{name}/stash-list` | stash一覧 |
| `POST /workspaces/{name}/stash` | git stash |
| `POST /workspaces/{name}/stash-pop` | git stash pop |
| `POST /workspaces/{name}/stash-drop` | git stash drop |
| `POST /workspaces/{name}/stash-pop-ref` | stash pop by ref |
| `GET /workspaces/{name}/files` | ファイル一覧 |
| `GET /workspaces/{name}/file-content` | ファイル内容取得 |
| `GET /workspaces/{name}/jobs` | ジョブ一覧 |
| `POST /workspaces/{name}/jobs` | ジョブ作成 |
| `PUT /workspaces/{name}/jobs/{name}` | ジョブ更新 |
| `DELETE /workspaces/{name}/jobs/{name}` | ジョブ削除 |
| `GET /github/repos` | GitHubリポジトリ一覧（gh CLI経由） |
| `GET /terminal/sessions` | ターミナルセッション一覧 |
| `DELETE /terminal/sessions/{id}` | ターミナルセッション削除 |
| `WS /terminal/ws/{id}` | ターミナルWebSocket |
| `POST /upload-image` | 画像アップロード（最大10MB） |
| `GET /system/processes` | プロセス一覧 |
| `GET /system/info` | システム情報 |
| `GET /settings/export` | 設定エクスポート |
| `POST /settings/import` | 設定インポート |
| `GET /logs` | ネットワークログ取得 |
| `DELETE /logs` | ネットワークログ消去 |
| `POST /logs/client` | クライアントログ送信 |
| `GET /op-logs` | 操作ログ取得 |
| `DELETE /op-logs` | 操作ログクリア |

## フロントエンド モジュール依存マップ

### 変更時に注意が必要なモジュール（影響範囲大）

| モジュール | 被依存数 | 主要export | 変更時の注意 |
|-----------|---------|-----------|------------|
| `state-core.js` | 37 | `token`, `selectedWorkspace`, `allWorkspaces`, `openTabs`, `activeTabId`, `splitMode` | ほぼ全モジュールが依存。export名の変更・削除は全体に波及 |
| `utils.js` | 35 | `$`, `escapeHtml`, `showToast`, `bindLongPress`, `renderActionButtons` | DOM操作・UI補助の基盤。シグネチャ変更は広範囲に影響 |
| `api-client.js` | 21 | `apiFetch`, `workspaceApiPath`, `postWorkspaceAction`, `fetchAndRenderWithStatus` | API通信の共通層。レスポンス形式の変更は呼び出し元すべてに影響 |
| `terminal-tabs.js` | 12 | `addTerminalTab`, `removeTab`, `switchTab`, `persistOpenTabs` | ターミナル・Git・ジョブから参照。タブ操作のインターフェース変更に注意 |

### 変更時の確認ガイド

- **`state-core.js`** を変更 → Git系・ターミナル系・ジョブ系・設定系すべてを確認
- **`utils.js`** を変更 → 使用箇所を `Grep` で検索し影響範囲を特定
- **`api-client.js`** を変更 → 全APIコール箇所（Git操作・ジョブ・設定・ファイル操作）を確認
- **`terminal-tabs.js`** を変更 → `terminal-*.js` 全般と `bootstrap.js`, `jobs.js` を確認

### 循環依存に関する注意

以下のモジュール間で循環依存が存在し、遅延importで解決している:
- `terminal-tabs.js` → `terminal-connection.js`（遅延import）
- `terminal-tabs.js` → `terminal-view-mode.js`（遅延import）
- `utils.js` → `workspace.js`（遅延参照）

新規importを追加する際は循環依存を生まないよう注意すること。
