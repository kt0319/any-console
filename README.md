# any-console

[![CI](https://github.com/kt0319/any-console/actions/workflows/ci.yml/badge.svg)](https://github.com/kt0319/any-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776ab.svg)](https://www.python.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4fc08d.svg)](https://vuejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg)](https://fastapi.tiangolo.com/)

**スマホとPCで途切れない開発コンソール。** 同じ tmux セッションをブラウザから両方のデバイスで触れる、セルフホスト型の Web 操作環境。

## なぜ any-console か

- **デバイス間シームレス** — PC で `npm test` を流して、移動中スマホで結果を見て、帰宅後 PC で続きを書く。tmux セッションが永続化され、ブラウザを閉じても同じセッションに再接続できる
- **モバイルで本気で打てる** — フリック入力対応の独自仮想キーボード。スマホから git commit や端末操作が現実的にできる
- **ジョブ・Git・ターミナル統合** — 個別ツールを行き来せず、ワンタップでスクリプト実行から git push まで完結

## 特徴

- **永続セッション** — tmux × WebSocket で、デバイスを切り替えても同じセッションを続けられる
- **モバイル最適入力** — フリック入力の独自キーボード、スワイプ操作対応
- **Webターミナル** — xterm.js ベース、複数タブ・分割表示
- **Git操作** — ブランチ切替、commit、push/pull、diff、履歴、stash、merge/rebase を UI で完結
- **ジョブ実行** — シェルスクリプトをワンタップで起動、UI から定義・編集
- **PWA対応** — スマホ・PC にインストール可能
- **軽量構成** — Vue 3 + Pinia + FastAPI、Vite でビルド

## セットアップ

### Docker

```bash
git clone https://github.com/kt0319/any-console.git
cd any-console
docker compose -f docker/compose.yml up -d
```

`http://<host>:8888` にアクセス。

### Raspberry Pi (systemd)

```bash
git clone https://github.com/kt0319/any-console.git
cd any-console
./any-console setup
```

依存インストール、フロントエンドビルド、systemd 登録までまとめて実行する。

### 必要環境

- Python 3.11+
- Node.js 18+
- Git
- tmux

<details>
<summary>手動セットアップ</summary>

```bash
pip install -r requirements.txt
npm install
npm run build
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888
```

</details>

## 認証

- 起動時はトークン未設定（認証オフ）。Tailscale 等で網が閉じている前提の運用が想定
- UI の「Security」設定からトークンを発行・更新できる（`data/auth.json` に保存）
- 環境変数 `ANY_CONSOLE_TOKEN` でも設定可能

## コマンド一覧

すべての操作は `./any-console` コマンドで行う。

```
./any-console setup      初回セットアップ（依存インストール + ビルド + .env生成 + systemd登録）
./any-console update     最新版に更新（git pull + 依存更新 + ビルド + サービス再起動）
./any-console start      サービス起動
./any-console stop       サービス停止
./any-console restart    サービス再起動
./any-console status     状態表示（サービス状態、URL、バージョン）
./any-console logs       サービスログ表示（journalctl）
./any-console version    バージョン表示
./any-console dev        開発モード起動（FastAPI + Vite HMR）
```

### アップデート

```bash
./any-console update
```

`git pull` → 依存更新 → ビルド → サービス再起動を一括で行う。変更がなければスキップする。

### 開発モード

```bash
./any-console dev
```

FastAPI と Vite dev server を並列起動する。Ctrl+C で両方終了。

## ディレクトリ構成

```
api/                  バックエンド (FastAPI)
  routers/            ルーター (workspaces, git, jobs, terminal, settings, system, github)
  main.py             アプリ初期化、静的ファイル配信
  auth.py             Bearerトークン認証（オプション）
  runner.py           ジョブ実行 (subprocess)
  terminal_session.py tmux × pty.fork × WebSocket ブリッジ
  rate_limiter.py     レートリミッタ
  config.py           config.json 読み書き
ui/                   フロントエンド (Vue 3 + Pinia、Viteでビルド)
docker/               Docker 関連 (Dockerfile, compose.yml)
docs/                 設計ドキュメント (ARCHITECTURE.md)
config.json           設定ファイル（自動生成、.gitignore対象）
data/auth.json        トークン保存（.gitignore対象）
```

## 設定

- ワークスペースの設定（アイコン、ジョブ定義、リンク等）は `config.json` に保存される
- 設定モーダルからエクスポート/インポートが可能

## オプション依存

- `gh` CLI - GitHubリポジトリ一覧の取得に使用（なくても動作する）

## ライセンス

[MIT](LICENSE)
