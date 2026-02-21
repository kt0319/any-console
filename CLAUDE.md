# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。UIはモバイルファースト、PCにも対応。

## 起動・開発

```bash
# 依存インストール
pip install fastapi uvicorn websockets

# 開発サーバー起動
PI_CONSOLE_TOKEN=dev-token python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload

# systemdでの本番起動
sudo systemctl start pi-console
```

テストスイート・リンター設定は未導入。動作確認はブラウザで `http://<host>:8888` を開いて手動確認。

## アーキテクチャ

### バックエンド: `api/`

- **FastAPI** (Python 3.11+) の単一アプリケーション
- `main.py`: 全エンドポイント定義、ttyd WebSocketプロキシ、ターミナルセッション管理
- `auth.py`: 環境変数 `PI_CONSOLE_TOKEN` によるBearerトークン認証
- `runner.py`: subprocessでシェルスクリプトを実行（タイムアウト120秒）
- `jobs.py`: ジョブ定義（`JobDefinition` / `ArgOption` dataclass）、`JOBS` レジストリ

### フロントエンド: `ui/`

- **バニラJS**（フレームワーク・ビルドステップなし）
- `app.js`: SPA全体のロジック、状態管理、API呼び出し
- `index.html`: SPAシェル + 複数モーダル
- `styles.css`: CSS変数によるダークテーマ
- 状態はグローバル変数 + LocalStorageで永続化

### ジョブシステム: `jobs/`

- 各ジョブは独立したシェルスクリプト
- Workspace別に `.pi-console-jobs.json` で表示ジョブを制御
- Workspace独自ジョブは `.pi-console/jobs/*.sh` に配置

### ターミナル: ttyd連携

- ttydをランダムポート(10000-20000)で起動し、FastAPIがHTTP/WSプロキシする
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）、10分タイムアウト

## 主要API

| エンドポイント | 用途 |
|---|---|
| `POST /run` | ジョブ実行 |
| `GET /workspaces` | ワークスペース一覧 |
| `GET /workspaces/{name}/status` | Git状態 |
| `GET /workspaces/{name}/branches` | ブランチ一覧 |
| `POST /workspaces/{name}/checkout` | ブランチ切替 |
| `GET /workspaces/{name}/git-log` | コミット履歴 |
| `GET /workspaces/{name}/diff` | diff表示 |
| `GET /github/repos` | GitHubリポジトリ一覧（gh CLI経由） |
| `GET/WS /terminal/s/{id}/{path}` | ttydプロキシ |

## CSSルール

- `:hover` スタイルは使わない（モバイルファーストのため）
- クリック可能な要素はボタン風スタイル（背景色・ボーダーなど）で視覚的に区別する。下線でのクリック表現は使わない
- 状態変化はJSによるクラス付替え（`.active`, `.selected` など）で表現する

## 設計上の注意点

- ワークスペースルートは `~/work/` 固定（`WORK_DIR = Path.home() / "work"`）
- Git操作はすべてsubprocess呼び出し（ライブラリ不使用）
- 認証は単一トークン（ユーザー区別なし）
- フロントエンドはビルド不要。`ui/` 配下を直接StaticFilesとしてマウント
- systemdサービスは `kentaro` ユーザーで実行（`systemd/pi-console.service`）
