# アーキテクチャ詳細

CLAUDE.md から分離した参照用ドキュメント。変更時の影響範囲確認に使用する。

## バックエンド: `api/`

- **FastAPI** (Python 3.11+)
- `main.py`: アプリ初期化、ルーターマウント、画像アップロード、静的ファイル配信
- `auth.py`: 環境変数 `ANY_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでジョブ実行（タイムアウト120秒）
- `job_models.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）
- `common.py`: 共通定数（パス・タイムアウト・パターン）、`TTLCache`、`BACKGROUND_EXECUTOR`
- `terminal_session.py`: ターミナルセッション管理（tmux操作・PTYブリッジ・セッションレジストリ）
- `config.py`: `config.json` の読み書き・ロック管理
- `config_schema.py`: Pydanticによるconfig.jsonのスキーマ定義・検証
- `git_utils.py`: Gitコマンド実行ユーティリティ、ブランチ取得、git info キャッシュ

### ルーター: `api/routers/`

- `workspaces.py`: ワークスペース一覧・clone・GitHubリポジトリ一覧・ワークスペース設定
- `git.py`: Git関連サブルーターの結合マウント
- `git_branches.py`: ブランチ操作（checkout、作成、削除）、pull/push/fetch
- `git_history.py`: コミット履歴、cherry-pick、revert、reset
- `git_diff.py`: ワーキングツリーdiff、コミットdiff
- `git_files.py`: ファイルブラウザ、ファイル内容取得
- `git_shared.py`: Git操作の共通ユーティリティ（パス検証・stash ref検証）
- `jobs.py`: ジョブ一覧・作成・更新・削除、リンク管理、ジョブ実行、ターミナルセッション作成
- `terminal.py`: ターミナルREST API・WebSocketエンドポイント
- `settings.py`: 設定インポート/エクスポート
- `system.py`: システム情報・プロセス一覧
- `github.py`: GitHubリポジトリ一覧（gh CLI経由）

## フロントエンド: `ui/`

- **Vue 3 + Pinia**（Viteでビルド）
- `index.html`: SPAシェル
- `vue-main.js`: Vue/Piniaアプリ初期化

### コンポーネント: `ui/components/`

- `App.vue`: ルートコンポーネント
- `ScreenLogin.vue`: ログイン画面
- `ScreenMain.vue`: メイン画面
- `ScreenEmpty.vue`: 空状態画面
- `TabBar.vue` / `TabItem.vue` / `TabPills.vue`: タブバー・タブ管理
- `TabConfig.vue`: タブ設定
- `TerminalBase.vue` / `TerminalPane.vue` / `TerminalConfig.vue`: ターミナル
- `WorkspaceDetail.vue` / `WorkspaceOpen.vue` / `WorkspaceAdd.vue` / `WorkspaceConfig.vue` / `WorkspaceStatusBar.vue`: ワークスペース
- `GitFiles.vue` / `GitHistory.vue` / `GitStash.vue` / `GitLogGraph.vue`: Git操作
- `GitChangeBranch.vue` / `GitCommitForm.vue` / `GitActionBtn.vue`: Gitアクション
- `GitHubPane.vue`: GitHubリポジトリ一覧
- `FileBrowser.vue` / `FileItem.vue` / `FileTextViewer.vue`: ファイルブラウザ
- `JobConfig.vue`: ジョブ設定
- `KeyboardBase.vue` / `KeyboardInput.vue` / `KeyboardQwertyKey.vue` / `KeyboardMinimumKey.vue` / `KeyboardSnippet.vue`: キーボード入力
- `IconPicker.vue`: アイコン選択
- `Modal.vue` / `ModalMenu.vue`: モーダル
- `ServerInfo.vue`: サーバー情報
- `ConfigFile.vue` / `EditorConfig.vue`: 設定ファイル編集
- `AppToast.vue`: トースト通知

### ストア: `ui/stores/`（Pinia）

- `auth.js`: 認証（Token保存はLocalStorage+Cookie）
- `workspace.js`: ワークスペース状態
- `git.js`: Git操作状態
- `terminal.js`: ターミナルセッション状態
- `input.js`: キーボード入力データ
- `layout.js`: レイアウト・タブ・パネル配置

### コンポーザブル: `ui/composables/`

- `useApi.js`: API通信（Bearerトークン付与）
- `useTerminal.js`: xterm.js統合のWebターミナル
- `useGitAction.js` / `useGitCommitAction.js` / `useGitDiff.js`: Git操作
- `useKeyboard.js`: キーボード制御
- `useModal.js` / `useModalView.js`: モーダル制御
- `useViewport.js`: ビューポート高さ監視・キーボード表示判定
- `useLongPress.js` / `useSwipeDismiss.js` / `useSplitDropDrag.js`: ジェスチャー
- `useQuickInputData.js`: 入力候補データ

### ユーティリティ: `ui/utils/`

- `constants.js`: 共通定数
- `escape-html.js`: HTMLエスケープ
- `format.js`: フォーマット処理
- `git.js`: Gitユーティリティ
- `file-icon.js`: ファイルアイコン判定
- `render-icon.js`: アイコン描画
- `gesture.js`: ジェスチャー処理
- `view-mode.js`: ビューモード
- `upload-image-to-terminal.js`: ターミナルへの画像アップロード

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
| `GET /terminal/sessions/{id}/buffer` | ターミナルバッファ取得 |
| `DELETE /terminal/sessions/{id}` | ターミナルセッション削除 |
| `WS /terminal/ws/{id}` | ターミナルWebSocket |
| `POST /upload-image` | 画像アップロード（最大10MB） |
| `GET /system/processes` | プロセス一覧 |
| `GET /system/info` | システム情報 |
| `GET /settings/export` | 設定エクスポート |
| `POST /settings/import` | 設定インポート |

## フロントエンド 変更時の確認ガイド

| モジュール | 変更時の注意 |
|-----------|------------|
| `stores/*.js` | Piniaストアは複数コンポーネントから参照。export名の変更は広範囲に影響 |
| `composables/useApi.js` | API通信の共通層。レスポンス形式の変更は呼び出し元すべてに影響 |
| `utils/constants.js` | 定数変更は参照元すべてを確認 |
