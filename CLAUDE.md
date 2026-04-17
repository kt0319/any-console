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
- フロントエンド: `ui/`（Vue 3 + Pinia、Viteでビルド）
- ルーター: `api/routers/`

## ジョブシステム

- ジョブ定義は `config.json` に統合管理（ワークスペースごとの `jobs` セクション）
- UIからジョブの作成・編集・削除が可能（API経由で `config.json` を更新）
- 各ジョブは `command`, `label`, `icon`, `icon_color`, `confirm`, `terminal` を保持
- 実行は `subprocess` で行い、タイムアウトは120秒

## ワークスペースと設定

- ワークスペースルートはデフォルト `~/work/`（`default_workspace_dir()` で取得、環境変数 `ANY_CONSOLE_WORKSPACE_ROOT` で変更可能）
- 追加設定は `config.json`（ワークスペース単位）
  - `icon`, `icon_color`, `hidden`, `jobs`

## ターミナル

- tmuxセッションを前段で管理し、`pty.fork()` でattachしてWebSocketでブリッジ
- セッション管理ロジックは `api/terminal_session.py`、ルーターは `api/routers/terminal.py`
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）
- セッションタイムアウトなし（tmuxセッションが生きている限り再接続可能）

## UIルール

- UIのテキスト（confirm、alert、ラベル等）は英語で記述する

## CSSルール

- `:hover` スタイルは使わない（モバイルファーストのため）
- クリック可能な要素はボタン風スタイル（背景色・ボーダーなど）で視覚的に区別する。下線でのクリック表現は使わない
- 状態変化はJSによるクラス付替え（`.active`, `.selected` など）で表現する
- `backdrop-filter`（blur等）は使わない
- 複数コンポーネントで共有するCSSクラスは `ui/styles/` に配置し、scopedでない `<style>` で `@import` する

## フロントエンド設計ルール

- APIエンドポイント文字列は `ui/utils/endpoints.js` の定数を使用する（ハードコードしない）
- `setTimeout` 等のタイマー値は `ui/utils/constants.js` に定数定義する
- APIエラー通知は `apiGet/apiPost` の `{ errorMessage: "..." }` オプションを使用する（手動 `emit("toast:show")` より優先）
- 300行超のコンポーネントは責務分離を検討する（ロジックを `ui/composables/` に抽出）

## バックエンドAPIルール

- APIエラーレスポンスのエラーメッセージフィールドは `detail` を使用する（`message` ではない）
- `except Exception` の裸キャッチは避け、具体的な例外型を指定する
- subprocess実行失敗時は `OSError` も捕捉する

## 設計上の注意点

- Git操作はすべてsubprocess呼び出し（ライブラリ不使用）
- 認証は単一トークン（ユーザー区別なし）
- フロントエンドはViteでビルド。`dist/` があればそこから、なければ `ui/` から直接StaticFilesとしてマウント
- `main.py` で起動時にCSS/JSにキャッシュバスト用クエリパラメータを付与
- systemdサービス定義は `any-console` スクリプト内の `generate_service_unit()` で生成（`./any-console setup` で登録）
