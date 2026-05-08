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

- Python 3.11+、Node.js 18+
- 主要ライブラリ: `fastapi`, `uvicorn`, `websockets`, `python-dotenv`, `pydantic`, `python-multipart`, `anthropic`（`requirements.txt`）
- フロントエンド: `vite`、`vue`、`pinia`、`@xterm/xterm`、`highlight.js`、`@mdi/font`（`package.json`）
- 開発依存: `pytest`, `pytest-cov`, `ruff`, `mypy`, `httpx`
- 追加ツール（任意）
  - `gh` CLI: GitHubリポジトリ一覧・Issue/PR/Actions取得に使用
  - `tmux`: ターミナルセッション管理に必須（本番・開発とも）
  - `tailscale`: クライアント名解決（VPN判定）。なくても動作する

## 起動・開発

すべての運用操作は `./any-console <subcommand>` から行うのが標準。

```
./any-console setup      初回セットアップ（依存インストール + ビルド + .env生成 + systemd登録）
./any-console update     最新版に更新（git pull + 依存更新 + ビルド + サービス再起動）
./any-console start|stop|restart   サービス制御
./any-console status     状態表示（サービス状態、URL、バージョン）
./any-console logs       journalctl のサービスログ表示
./any-console version    バージョン表示
./any-console dev        開発モード起動（FastAPI + Vite HMR を並列起動、Ctrl+C で両方終了）
```

### 開発（Vite HMR）

`./any-console dev` を推奨。手動で並列起動する場合:

```bash
# 1. 依存インストール（初回のみ）
pip install -r requirements.txt
npm install

# 2. FastAPI（API側）を起動
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload --reload-include "*.py"

# 3. Vite dev server を別ターミナルで起動
npm run dev
# → localhost:5173 にアクセス（APIはプロキシで8888に転送）
```

- UI編集が即座にブラウザに反映される（HMR）
- APIリクエスト・WebSocketは `vite.config.js` のプロキシ設定で FastAPI に転送

### 本番（systemd / Docker）

systemd:

```bash
npm run build                       # dist/ を生成
sudo systemctl restart any-console  # ./any-console restart でも可
```

Docker:

```bash
docker compose -f docker/compose.yml up -d
```

- `dist/` があればそこから配信、なければ `ui/` から直接配信
- `dist/` を削除すれば従来通り `ui/` から直接配信に戻る
- `vite.config.js` のプラグインでvendor JS・静的ファイルを `dist/` にコピー

### 認証

- 認証は **オプション**。デフォルトでは無効（Tailscale等で網が閉じている前提）
- 有効化は2通り:
  - UIの「Security」設定からトークンを発行・更新（`data/auth.json` に保存）
  - 環境変数 `ANY_CONSOLE_TOKEN` を設定
- `data/auth.json` のトークンが優先され、なければ環境変数を使用（`api/auth.py`）
- `.env` は `python-dotenv` で `api/main.py` 起動時に自動読み込み
- Bearerトークン方式。WebSocketは `verify_ws_token()` で検証

## テスト・Lint

- バックエンド: `pytest`（`tests/`、`pytest-cov` でカバレッジ可）
- フロントエンド: `npm test`（`tests/ui/test_*.js`、`node:test` + `node:assert/strict`）
- フロントエンドカバレッジ: `npm run test:coverage`（`coverage/lcov.info` 生成）
- フロントエンドテストは純粋関数のインラインコピーパターン（DOM依存を排除）
- テスト対象関数を変更した場合、対応するテストファイルのインラインコピーも更新すること
- Lint: `ruff check api/`（設定は `pyproject.toml`、`select = E,F,W,I,B,S,C90`）
- 型: `mypy`（設定は `pyproject.toml`）
- CI: `.github/workflows/ci.yml`、カバレッジは codecov に送信（`codecov.yml`）

## アーキテクチャ

ファイル構成・API一覧・モジュール依存マップの詳細は **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** を参照。

### 概要

- バックエンド: `api/`（FastAPI + subprocess）
  - `main.py`: アプリ初期化、`/auth/check`、画像アップロード、静的ファイル配信
  - `auth.py`: トークン認証（環境変数 or `data/auth.json`）、Tailscale名前解決、IPバンド判定
  - `runner.py`: ジョブ実行（subprocess、120秒タイムアウト）
  - `terminal_session.py` / `tmux.py`: tmux × pty.fork × WebSocket ブリッジ
  - `git_utils.py` / `git_lock.py`: Gitコマンド実行とワークスペース単位のロック
  - `config.py` / `config_schema.py`: `config.json` の読み書きと Pydantic 検証
  - `rate_limiter.py`: APIレートリミッタ（ミドルウェア）
  - `client_log.py`: クライアントログ受信ミドルウェア
  - `validators.py` / `errors.py`: 入力検証と共通エラーレスポンス
  - `ai_summary.py`: git pull 結果の AI 要約（Anthropic SDK）
  - `icons.py`: アイコン関連処理
  - `common.py`: 共通定数・`TTLCache`・`BACKGROUND_EXECUTOR`
- ルーター: `api/routers/`
  - `workspaces`, `jobs`, `terminal`, `system`, `settings`
  - `git`（サブルーター集約）+ `git_branches`, `git_history`, `git_diff`, `git_files`
  - `git_helpers`, `git_diff_utils`, `git_file_utils`（共通ユーティリティ）
  - `github`（gh CLI 経由）
- フロントエンド: `ui/`（Vue 3 + Pinia、Viteでビルド）
  - `components/`, `stores/`, `composables/`, `utils/`, `styles/`
  - PWA対応（`ui/sw.js`, `ui/public/manifest.json`）

## ジョブシステム

- ジョブ定義は `config.json` に統合管理（ワークスペースごとの `jobs` セクション）
- UIからジョブの作成・編集・削除が可能（API経由で `config.json` を更新）
- 各ジョブは `command`, `label`, `description`, `icon`, `icon_color`, `confirm`, `hidden_tab` を保持
- 実行は `subprocess` で行い、タイムアウトは120秒

## ワークスペースと設定

- ワークスペースルートはデフォルト `~/work/`（`default_workspace_dir()` で取得、環境変数 `ANY_CONSOLE_WORKSPACE_ROOT` で変更可能）
- 追加設定は `config.json`（ワークスペース単位）
  - `icon`, `icon_color`, `hidden`, `jobs`

## ターミナル

- セッション管理は **tmux** が担う。各ターミナルタブは1つのtmuxセッションに対応する
- ブラウザ接続時は `pty.fork()` でtmuxにattachし、WebSocketでブリッジする
- ブラウザを閉じてもtmuxセッションは生き続け、再接続時に同じセッションに戻れる
- セッション管理ロジックは `api/terminal_session.py`、ルーターは `api/routers/terminal.py`
- セッションのメタ情報（ワークスペース・ジョブ名等）はtmuxセッション名とsuffixで管理
- セッションはインメモリ管理（`TERMINAL_SESSIONS` dict）でサーバー再起動時に揮発するが、tmuxセッション自体は残るため再起動後も復元可能
- セッションタイムアウトなし

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
- 認証は単一トークン（ユーザー区別なし）。デフォルトは認証オフ
- フロントエンドはViteでビルド。`dist/` があればそこから、なければ `ui/` から直接StaticFilesとしてマウント
- `main.py` で起動時にCSS/JSにキャッシュバスト用クエリパラメータを付与
- systemdサービス定義は `any-console` スクリプト内で生成（`./any-console setup` で登録）
- Docker構成は `docker/Dockerfile` および `docker/compose.yml`
- `AGENTS.md` は `CLAUDE.md` へのシンボリックリンク（同内容を共有）
- `data/auth.json` と `config.json` は `.gitignore` 対象。実環境で自動生成される
