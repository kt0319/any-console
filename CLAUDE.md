# AGENTS.md / CLAUDE.md

このファイルは、このリポジトリで作業するコーディングエージェント向けの共通ガイドです。
`AGENTS.md` として参照されても同じ内容を適用します。

## プロジェクト概要

Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。UIはモバイルファースト、PCにも対応。

## 動作環境

- **本番**: Raspberry Pi (Raspberry Pi OS / Debian系)
- **開発・検証**: macOS、Linux でも動作する
- OS固有の機能には依存しない設計とする（Linux専用コマンド等を前提にしない）

## 依存関係

- Python 3.11+
- 主要ライブラリ: `fastapi`, `uvicorn`, `websockets`, `python-dotenv`（`requirements.txt`）
- フロントエンド: `vite`（`package.json`）
- 追加ツール（任意）
  - `gh` CLI: GitHubリポジトリ一覧取得に使用
  - `pytest`: テスト実行に使用
  - `ruff`: lint（`pyproject.toml`）

## 起動・開発

```bash
# 依存インストール
pip install -r requirements.txt
npm install
```

### 開発（Vite HMR）

```bash
# 1. FastAPI（API側）を起動
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload --reload-include "*.py"

# 2. Vite dev server を別ターミナルで起動
npm run dev
# → localhost:5173 にアクセス（APIはプロキシで8888に転送）
```

- UI編集が即座にブラウザに反映される（HMR）
- APIリクエスト・WebSocketは `vite.config.js` のプロキシ設定で FastAPI に転送
- `.env` がない場合は `ANY_CONSOLE_TOKEN=dev-token` を付けて FastAPI を起動

### 本番（pi:8888）

```bash
# ビルド → dist/ を生成
npm run build

# FastAPI起動（dist/ があればそこから配信、なければ ui/ から直接配信）
sudo systemctl restart any-console
```

- `dist/` を削除すれば従来通り `ui/` から直接配信に戻る
- `vite.config.js` のプラグインでvendor JS・静的ファイルを `dist/` にコピー

### 認証

- 環境変数 `ANY_CONSOLE_TOKEN` によるBearerトークン認証
- `.env` は `python-dotenv` で `api/main.py` 起動時に自動読み込み

## テスト・Lint

- バックエンド: `pytest`（`tests/`）
- フロントエンド: `npm test`（`tests/ui/test_*.js`、`node:test` + `node:assert/strict`）
- フロントエンドテストは純粋関数のインラインコピーパターン（DOM依存を排除）
- テスト対象関数を変更した場合、対応するテストファイルのインラインコピーも更新すること
- `ruff` 設定は `pyproject.toml`

## アーキテクチャ

ファイル構成・API一覧・モジュール依存マップの詳細は **[ARCHITECTURE.md](./ARCHITECTURE.md)** を参照。

### 概要

- バックエンド: `api/`（FastAPI + subprocess）
- フロントエンド: `ui/`（バニラJS、フレームワークなし）
- ルーター: `api/routers/`

## ジョブシステム

- ジョブ定義は `config.json` に統合管理（ワークスペースごとの `jobs` セクション）
- UIからジョブの作成・編集・削除が可能（API経由で `config.json` を更新）
- 各ジョブは `command`, `label`, `icon`, `icon_color`, `confirm`, `terminal` を保持
- 実行は `subprocess` で行い、タイムアウトは120秒

## ワークスペースと設定

- ワークスペースルートは `~/work/` 固定（`WORK_DIR = Path.home() / "work"`）
- 追加設定は `config.json`（ワークスペース単位）
  - `icon`, `icon_color`, `hidden`, `jobs`

## ターミナル

- `pty.fork()` でシェルプロセス生成し、FastAPIがWebSocketでブリッジ
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）
- セッションタイムアウトは2時間（`TERMINAL_TIMEOUT_SEC = 7200`）

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
- systemdサービス定義は `systemd/any-console.service`（パスはインストール環境に合わせて編集）
