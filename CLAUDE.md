# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。UIはモバイルファースト、PCにも対応。

### 動作環境

- **本番**: Raspberry Pi (Raspberry Pi OS / Debian系)
- **開発・検証**: macOS、Linux でも動作する
- OS固有の機能には依存しない設計とする（Linux専用コマンド等を前提にしない）

## 起動・開発

```bash
# 依存インストール
pip install fastapi uvicorn websockets python-dotenv
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

テストスイート・リンター設定は未導入。動作確認はブラウザで `http://<host>:8888` を開いて手動確認。

## アーキテクチャ

### バックエンド: `api/`

- **FastAPI** (Python 3.11+)
- `main.py`: アプリ初期化、ルーターマウント、画像アップロード、システム情報、静的ファイル配信
- `auth.py`: 環境変数 `PI_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでシェルスクリプトを実行（タイムアウト120秒）
- `jobs.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）
- `common.py`: 共通定数（`WORK_DIR`, `UPLOAD_DIR`, `TERMINAL_TIMEOUT_SEC`）、Git情報取得ユーティリティ
- `.env`: `python-dotenv` で `main.py` 起動時に自動読み込み

### ルーター: `api/routers/`

- `workspaces.py`: ワークスペース一覧・clone・GitHubリポジトリ一覧
- `git.py`: ブランチ操作、checkout、pull/push、git-log、diff、cherry-pick、revert、reset、stash
- `jobs.py`: ジョブ一覧・作成・削除・実行、リンク管理、ターミナルセッション作成
- `terminal.py`: PTYベースのターミナルセッション管理、WebSocket通信

### フロントエンド: `ui/`

- **バニラJS**（フレームワーク・ビルドステップなし）
- `index.html`: SPAシェル
- `app.js`: メインロジック、ページルーティング
- `state.js`: グローバル状態管理
- `auth.js`: 認証処理
- `workspace.js`: ワークスペース一覧・選択
- `git.js`: Git操作UI
- `jobs.js`: ジョブ一覧・実行・作成UI
- `terminal.js`: xterm.js統合のWebターミナル
- `settings.js`: 設定画面
- `quick-input.js`: 汎用入力・選択UI
- `icon-picker.js`: アイコン選択UI
- `utils.js`: ユーティリティ
- `styles.css`: CSS変数によるダークテーマ
- 状態はグローバル変数 + LocalStorageで永続化

### ジョブシステム

- 各ワークスペースの `.pi-console/jobs/*.sh` にジョブスクリプトを配置
- スクリプトヘッダにメタデータ記述可能（`# icon:`, `# icon-color:`, `# open-url:`）

### ターミナル: Python PTY

- `pty.fork()` でシェルプロセスを生成し、FastAPIがWebSocketでブリッジ
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）、30分タイムアウト
- フロントエンドはxterm.jsで描画

## 主要API

| エンドポイント | 用途 |
|---|---|
| `GET /auth/check` | 認証確認 |
| `POST /run` | ジョブ実行・ターミナル作成 |
| `GET /workspaces` | ワークスペース一覧 |
| `POST /workspaces` | リポジトリclone |
| `GET /workspaces/{name}/status` | Git状態 |
| `GET /workspaces/{name}/branches` | ローカルブランチ一覧 |
| `GET /workspaces/{name}/branches/remote` | リモートブランチ一覧 |
| `POST /workspaces/{name}/checkout` | ブランチ切替 |
| `POST /workspaces/{name}/create-branch` | ブランチ作成 |
| `POST /workspaces/{name}/pull` | git pull --rebase |
| `POST /workspaces/{name}/push` | git push |
| `POST /workspaces/{name}/fetch` | git fetch |
| `POST /workspaces/{name}/stash` | git stash |
| `POST /workspaces/{name}/stash-pop` | git stash pop |
| `POST /workspaces/{name}/cherry-pick` | cherry-pick |
| `POST /workspaces/{name}/revert` | revert |
| `POST /workspaces/{name}/reset` | reset (soft/hard) |
| `GET /workspaces/{name}/git-log` | コミット履歴 |
| `GET /workspaces/{name}/diff` | ワーキングツリーdiff |
| `GET /workspaces/{name}/diff/{hash}` | コミットdiff |
| `GET /workspaces/{name}/jobs` | ジョブ一覧 |
| `POST /workspaces/{name}/jobs` | ジョブ作成 |
| `DELETE /workspaces/{name}/jobs/{name}` | ジョブ削除 |
| `GET /workspaces/{name}/links` | リンク一覧 |
| `POST /workspaces/{name}/links` | リンク作成 |
| `DELETE /workspaces/{name}/links/{index}` | リンク削除 |
| `GET /github/repos` | GitHubリポジトリ一覧（gh CLI経由） |
| `GET /terminal/sessions` | ターミナルセッション一覧 |
| `DELETE /terminal/sessions/{id}` | ターミナルセッション削除 |
| `WS /terminal/ws/{id}` | ターミナルWebSocket |
| `POST /upload-image` | 画像アップロード |
| `GET /system/info` | システム情報 |

## CSSルール

- `:hover` スタイルは使わない（モバイルファーストのため）
- クリック可能な要素はボタン風スタイル（背景色・ボーダーなど）で視覚的に区別する。下線でのクリック表現は使わない
- 状態変化はJSによるクラス付替え（`.active`, `.selected` など）で表現する
- `backdrop-filter`（blur等）は使わない

## 設計上の注意点

- ワークスペースルートは `~/work/` 固定（`WORK_DIR = Path.home() / "work"`）
- Git操作はすべてsubprocess呼び出し（ライブラリ不使用）
- 認証は単一トークン（ユーザー区別なし）
- フロントエンドはビルド不要。`ui/` 配下を直接StaticFilesとしてマウント
- `main.py` で起動時にCSS/JSにキャッシュバスト用クエリパラメータを付与
- systemdサービスは `kentaro` ユーザーで実行（`systemd/pi-console.service`）
