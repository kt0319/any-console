# アーキテクチャ詳細

CLAUDE.md から分離した参照用ドキュメント。変更時の影響範囲確認に使用する。

## バックエンド: `api/`

- **FastAPI** (Python 3.11+)
- `main.py`: アプリ初期化、ルーターマウント、画像アップロード、静的ファイル配信
- `auth.py`: 環境変数 `ANY_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでジョブ実行（タイムアウト120秒）
- `job_models.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）
- `common.py`: 共通定数（パス・タイムアウト・パターン・ファイルサイズ制限）、`TTLCache`、`BACKGROUND_EXECUTOR`
- `tmux.py`: tmux subprocess操作（セッション作成・接続・削除・存在確認・メタデータ読み書き）
- `terminal_session.py`: TerminalSessionクラス・セッション管理（CRUD・cleanup）・PTYブリッジ
- `config.py`: `config.json` の読み書き・ロック管理
- `config_schema.py`: Pydanticによるconfig.jsonのスキーマ定義・検証
- `git_utils.py`: Gitコマンド実行ユーティリティ（`run_git_raw`/`run_git_query`/`run_git_command`）、ブランチ取得、git info キャッシュ
- `client_log.py`: クライアントログ受信
- `errors.py`: 共通エラーハンドリング
- `icons.py`: アイコン関連処理
- `rate_limiter.py`: APIレートリミッター
- `validators.py`: 入力バリデーション

### ルーター: `api/routers/`

- `workspaces.py`: ワークスペース一覧・clone・削除・設定・順序変更
- `git.py`: Git関連サブルーターの結合マウント
- `git_branches.py`: ブランチ操作（checkout、作成、削除）、pull/push/fetch/set-upstream
- `git_history.py`: コミット履歴、cherry-pick、revert、merge、rebase、reset、stash
- `git_diff.py`: ワーキングツリーdiff、コミットdiff
- `git_files.py`: ファイルブラウザ、ファイル内容取得、アップロード、リネーム、削除、ダウンロード
- `git_helpers.py`: Gitアクション実行・パス検証・ブランチ取得
- `git_file_utils.py`: ファイル内容取得・ディレクトリ一覧・gitignore判定
- `git_diff_utils.py`: diff統計パース（numstat）・ファイルリスト構築
- `jobs.py`: ジョブ一覧・作成・更新・削除・順序変更、グローバルジョブ、ジョブ実行、ターミナルセッション作成
- `terminal.py`: ターミナルREST API・WebSocketエンドポイント
- `settings.py`: 設定インポート/エクスポート、エディタ設定、スニペット
- `system.py`: システム情報・プロセス一覧
- `github.py`: GitHubリポジトリ情報・Issue・PR・Actions（gh CLI経由）

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
- `GitFiles.vue` / `GitHistory.vue` / `GitStash.vue`: Git操作
- `GitChangeBranch.vue` / `GitCommitForm.vue` / `GitActionBtn.vue`: Gitアクション
- `GitHubPane.vue`: GitHubリポジトリ一覧
- `FileBrowser.vue` / `FileItem.vue` / `FileTextViewer.vue`: ファイルブラウザ
- `JobConfig.vue` / `GlobalJobConfig.vue`: ジョブ設定
- `KeyboardBase.vue` / `KeyboardInput.vue` / `KeyboardQwertyKey.vue` / `KeyboardMinimumKey.vue` / `KeyboardSnippet.vue`: キーボード入力
- `IconPicker.vue`: アイコン選択
- `Modal.vue` / `ModalMenu.vue`: モーダル
- `ServerInfo.vue`: サーバー情報
- `ClientInfo.vue`: クライアント情報
- `ConfigFile.vue` / `EditorConfig.vue`: 設定ファイル編集
- `AppToast.vue`: トースト通知

### ストア: `ui/stores/`（Pinia）

- `auth.js`: 認証（Token保存はLocalStorage+Cookie）
- `workspace.js`: ワークスペース状態
- `git.js`: Git操作状態
- `terminal.js`: ターミナルセッション状態
- `input.js`: キーボード入力データ
- `layout.js`: レイアウト・分割モード・パネル配置

### コンポーザブル: `ui/composables/`

- `useApi.js`: API通信（Bearerトークン付与・`apiWithToast`による共通toast通知）
- `useTerminal.js`: xterm.js統合のWebターミナル
- `useGitAction.js` / `useGitCommitAction.js` / `useGitDiff.js`: Git操作
- `useKeyboard.js`: キーボード制御
- `useModal.js` / `useModalView.js`: モーダル制御
- `useViewport.js`: ビューポート高さ監視・キーボード表示判定
- `useLongPress.js` / `useSwipeDismiss.js` / `useSplitDropDrag.js`: ジェスチャー
- `useFileDragDrop.js`: ファイルドラッグ&ドロップアップロード
- `useWorkspaceDrag.js`: ワークスペース並び替えドラッグ
- `useQuickInputData.js`: 入力候補データ
- `useEditorIntegration.js`: エディタ設定・システム情報の取得
- `useFileActions.js`: ファイル削除等のアクション
- `useFileDiff.js`: ファイルdiff状態管理
- `useGitLogPagination.js`: Gitログのページネーション・グラフ行構築
- `useTerminalResize.js`: ターミナルリサイズ処理（fitTerminal）
- `useWorkspaceJobManager.js`: ワークスペースのジョブ管理

### ユーティリティ: `ui/utils/`

- `constants.js`: 共通定数
- `endpoints.js`: APIエンドポイントパス生成ユーティリティ
- `escape-html.js`: HTMLエスケープ
- `format.js`: フォーマット処理
- `display.js`: 表示用フォーマット（`toDisplayMessage` 等）
- `git.js`: Gitユーティリティ
- `git-diff.js`: diffテキストのパース・ファイル分割
- `git-graph.js`: Gitグラフ描画データ生成（ログパース・行構築）
- `file-icon.js`: ファイルアイコン判定
- `file-browser.js`: ファイルブラウザ関連ユーティリティ（拡張子マッピング等）
- `render-icon.js`: アイコン描画
- `gesture.js`: ジェスチャー処理
- `view-mode.js`: ビューモード
- `page-unload.js`: ページアンロード前の確認制御
- `settings-utils.js`: SSH URL変換等の設定ユーティリティ
- `terminal-settings.js`: ターミナル設定スキーマ定義
- `terminal-ws.js`: ターミナルWebSocket URL構築
- `upload-image-to-terminal.js`: ターミナルへの画像アップロード

## 主要API

| エンドポイント | 用途 |
|---|---|
| `GET /auth/check` | 認証確認 |
| `POST /run` | ジョブ実行・ターミナル作成 |
| `GET /workspaces` | ワークスペース一覧 |
| `GET /workspaces/statuses` | ワークスペースGitステータス一覧 |
| `POST /workspaces` | ワークスペース追加（新規作成・clone・既存登録） |
| `DELETE /workspaces/{name}` | ワークスペース削除 |
| `PUT /workspace-order` | ワークスペース順序更新 |
| `PUT /workspaces/{name}/config` | ワークスペース設定更新 |
| `GET /workspaces/{name}/status` | Git状態 |
| `GET /workspaces/{name}/branches` | ローカルブランチ一覧 |
| `GET /workspaces/{name}/branches/remote` | リモートブランチ一覧 |
| `POST /workspaces/{name}/checkout` | ブランチ切替 |
| `POST /workspaces/{name}/create-branch` | ブランチ作成 |
| `POST /workspaces/{name}/delete-branch` | ブランチ削除 |
| `POST /workspaces/{name}/pull` | git pull |
| `POST /workspaces/{name}/push` | git push |
| `POST /workspaces/{name}/set-upstream` | アップストリーム設定 |
| `POST /workspaces/{name}/push-upstream` | アップストリーム設定+push |
| `POST /workspaces/{name}/fetch` | git fetch --prune |
| `GET /workspaces/{name}/git-log` | コミット履歴 |
| `POST /workspaces/{name}/commit` | git commit |
| `POST /workspaces/{name}/cherry-pick` | cherry-pick |
| `POST /workspaces/{name}/revert` | revert |
| `POST /workspaces/{name}/merge` | merge |
| `POST /workspaces/{name}/rebase` | rebase |
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
| `POST /workspaces/{name}/upload` | ファイルアップロード |
| `POST /workspaces/{name}/rename` | ファイル/ディレクトリリネーム |
| `POST /workspaces/{name}/delete-file` | ファイル/ディレクトリ削除 |
| `GET /workspaces/{name}/download` | ファイルダウンロード |
| `GET /workspaces/{name}/jobs` | ジョブ一覧 |
| `GET /workspaces/{name}/jobs/{job_name}` | ジョブ取得 |
| `POST /workspaces/{name}/jobs` | ジョブ作成 |
| `PUT /workspaces/{name}/jobs/{job_name}` | ジョブ更新 |
| `DELETE /workspaces/{name}/jobs/{job_name}` | ジョブ削除 |
| `PUT /workspaces/{name}/job-order` | ジョブ順序更新 |
| `GET /jobs/workspaces` | 全ワークスペースのジョブ一覧 |
| `GET /global/jobs` | グローバルジョブ一覧 |
| `POST /global/jobs` | グローバルジョブ作成 |
| `PUT /global/jobs/{job_name}` | グローバルジョブ更新 |
| `DELETE /global/jobs/{job_name}` | グローバルジョブ削除 |
| `PUT /global/job-order` | グローバルジョブ順序更新 |
| `GET /workspaces/{name}/github/info` | GitHubリポジトリ情報 |
| `GET /workspaces/{name}/github/issues` | GitHub Issue一覧 |
| `GET /workspaces/{name}/github/pulls` | GitHub PR一覧 |
| `GET /workspaces/{name}/github/runs` | GitHub Actions実行履歴 |
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
| `GET /settings/editor` | エディタ設定取得 |
| `PUT /settings/editor` | エディタ設定更新 |
| `GET /snippets` | コマンドスニペット一覧 |
| `PUT /snippets` | スニペット更新 |

## フロントエンド 変更時の確認ガイド

| モジュール | 変更時の注意 |
|-----------|------------|
| `stores/*.js` | Piniaストアは複数コンポーネントから参照。export名の変更は広範囲に影響 |
| `composables/useApi.js` | API通信の共通層。レスポンス形式の変更は呼び出し元すべてに影響 |
| `utils/constants.js` | 定数変更は参照元すべてを確認 |
