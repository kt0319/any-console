# AGENTS.md / CLAUDE.md

このファイルは、このリポジトリで作業するコーディングエージェント向けの共通ガイドです。
`AGENTS.md` として参照されても同じ内容を適用します。

## プロジェクト概要

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。UIはモバイルファースト、PCにも対応。

## コミットメッセージ

- コミットメッセージは日本語で記述する

## 動作環境

- **本番**: Raspberry Pi (Raspberry Pi OS / Debian系)
- **開発・検証**: macOS、Linux でも動作する
- OS固有の機能には依存しない設計とする（Linux専用コマンド等を前提にしない）

## 依存関係

- Python 3.11+
- 主要ライブラリ: `fastapi`, `uvicorn`, `websockets`, `python-dotenv`（`requirements.txt`）
- 追加ツール（任意）
  - `gh` CLI: GitHubリポジトリ一覧取得に使用
  - `pytest`: テスト実行に使用
  - `ruff`: lint（`pyproject.toml`）

## 起動・開発

```bash
# 依存インストール
pip install -r requirements.txt
```

### macOS（開発）

```bash
# 開発サーバー起動（.envがある場合はTOKEN指定不要）
# --reload-include "*.py" でPython変更時のみリロード（UI編集でターミナルセッションが飛ばない）
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload --reload-include "*.py"

# .envがない場合はTOKENを明示指定
PI_CONSOLE_TOKEN=dev-token python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload --reload-include "*.py"
```

### Raspberry Pi（本番）

```bash
# systemdで起動・停止
sudo systemctl start pi-console
sudo systemctl stop pi-console
sudo systemctl restart pi-console
```

### 認証

- 環境変数 `PI_CONSOLE_TOKEN` によるBearerトークン認証
- `.env` は `python-dotenv` で `api/main.py` 起動時に自動読み込み

## テスト・Lint

- `pytest`（`tests/`）
- `ruff` 設定は `pyproject.toml`

## アーキテクチャ

### バックエンド: `api/`

- **FastAPI** (Python 3.11+)
- `main.py`: アプリ初期化、ルーターマウント、画像アップロード、システム情報、静的ファイル配信、設定インポート/エクスポート
- `auth.py`: 環境変数 `PI_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでジョブ実行（タイムアウト120秒）
- `jobs.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）
- `common.py`: 共通定数、設定ファイル管理（`data/config.json`）、Gitユーティリティ、ログバッファ

### ルーター: `api/routers/`

- `workspaces.py`: ワークスペース一覧・clone・GitHubリポジトリ一覧・ワークスペース設定
- `git.py`: ブランチ操作、checkout、pull/push、git-log、diff、stash、commit、ファイルブラウザ
- `jobs.py`: ジョブ一覧・作成・更新・削除、リンク管理、ジョブ実行、ターミナルセッション作成
- `terminal.py`: PTYベースのターミナルセッション管理、WebSocket通信
- `logs.py`: 操作ログの取得・クリア・クライアントログ受信

### フロントエンド: `ui/`

- **バニラJS**（フレームワーク・ビルドステップなし）
- `index.html`: SPAシェル
- `app.js`: メインロジック、初期化
- `state.js`: グローバル状態管理
- `auth.js`: 認証処理（Token保存はLocalStorage+Cookie）
- `workspace.js`: ワークスペース一覧・選択
- `git.js`: Git操作UI
- `git-diff.js`: Git差分表示
- `git-file-browser.js`: ファイルブラウザ
- `jobs.js`: ジョブ一覧・実行・作成UI
- `terminal.js`: xterm.js統合のWebターミナル
- `terminal-tabs.js`: タブ管理
- `terminal-split.js`: ターミナル分割表示
- `terminal-connection.js`: 端末セッション同期
- `terminal-tab-modal.js`: ワークスペース/設定モーダル
- `terminal-copy-mode.js`: ターミナルコピー
- `settings.js`: 設定画面、設定インポート/エクスポート
- `quick-input.js`: 汎用入力UI
- `quick-input-keys.js`: 端末ショートカット/画像アップロード
- `icon-picker.js`: アイコン選択UI
- `logger.js`: クライアントログ送信
- `utils.js`: ユーティリティ
- `styles.css`: CSS変数によるダークテーマ
- 状態はグローバル変数 + LocalStorageで永続化

## ジョブシステム

- ジョブ定義は `data/config.json` に統合管理（ワークスペースごとの `jobs` セクション）
- UIからジョブの作成・編集・削除が可能（API経由で `config.json` を更新）
- 各ジョブは `command`, `label`, `icon`, `icon_color`, `confirm`, `terminal` を保持
- 実行は `subprocess` で行い、タイムアウトは120秒

## ワークスペースと設定

- ワークスペースルートは `~/work/` 固定（`WORK_DIR = Path.home() / "work"`）
- 追加設定は `data/config.json`（ワークスペース単位）
  - `icon`, `icon_color`, `hidden`, `jobs`, `links`
- 旧形式（`data/*.json` や `~/.config/pi-console`）からのマイグレーションあり

## ターミナル

- `pty.fork()` でシェルプロセス生成し、FastAPIがWebSocketでブリッジ
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）
- セッションタイムアウトは2時間（`TERMINAL_TIMEOUT_SEC = 7200`）

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
| `POST /workspaces/{name}/stash-pop-index` | stash pop by ref |
| `GET /workspaces/{name}/files` | ファイル一覧 |
| `GET /workspaces/{name}/file-content` | ファイル内容取得 |
| `GET /workspaces/{name}/jobs` | ジョブ一覧 |
| `POST /workspaces/{name}/jobs` | ジョブ作成 |
| `PUT /workspaces/{name}/jobs/{name}` | ジョブ更新 |
| `DELETE /workspaces/{name}/jobs/{name}` | ジョブ削除 |
| `GET /workspaces/{name}/links` | リンク一覧 |
| `POST /workspaces/{name}/links` | リンク作成 |
| `PUT /workspaces/{name}/links/{index}` | リンク更新 |
| `DELETE /workspaces/{name}/links/{index}` | リンク削除 |
| `GET /github/repos` | GitHubリポジトリ一覧（gh CLI経由） |
| `GET /terminal/sessions` | ターミナルセッション一覧 |
| `DELETE /terminal/sessions/{id}` | ターミナルセッション削除 |
| `WS /terminal/ws/{id}` | ターミナルWebSocket |
| `POST /upload-image` | 画像アップロード（最大10MB） |
| `GET /system/processes` | プロセス一覧 |
| `GET /system/info` | システム情報 |
| `GET /settings/export` | 設定エクスポート |
| `POST /settings/import` | 設定インポート |
| `GET /logs` | 操作ログ取得 |
| `DELETE /logs` | 操作ログ消去 |
| `POST /logs/client` | クライアントログ送信 |

## CSSルール

- `:hover` スタイルは使わない（モバイルファーストのため）
- クリック可能な要素はボタン風スタイル（背景色・ボーダーなど）で視覚的に区別する。下線でのクリック表現は使わない
- 状態変化はJSによるクラス付替え（`.active`, `.selected` など）で表現する
- `backdrop-filter`（blur等）は使わない

## 設計上の注意点

- Git操作はすべてsubprocess呼び出し（ライブラリ不使用）
- 認証は単一トークン（ユーザー区別なし）
- フロントエンドはビルド不要。`ui/` 配下を直接StaticFilesとしてマウント
- `main.py` で起動時にCSS/JSにキャッシュバスト用クエリパラメータを付与
- systemdサービスは `kentaro` ユーザーで実行（`systemd/pi-console.service`）
