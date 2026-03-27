# any-console

[![CI](https://github.com/kt0319/any-console/actions/workflows/ci.yml/badge.svg)](https://github.com/kt0319/any-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776ab.svg)](https://www.python.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3-4fc08d.svg)](https://vuejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg)](https://fastapi.tiangolo.com/)

Web操作コンソール。スマホやPCのブラウザからシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。

## 特徴

- **Webターミナル** - xterm.jsベースのフルターミナル（複数タブ・分割表示対応）
- **Git操作** - ブランチ切替、commit、push/pull、diff表示、履歴閲覧をUIから操作
- **ジョブ実行** - シェルスクリプトをワンタップで実行（UIから定義・編集可能）
- **ワークスペース管理** - `~/work/` 配下のディレクトリを一覧・切替
- **モバイルファースト** - スマホ操作に最適化されたUI（PC対応）
- **軽量構成** - Vue 3 + Pinia + FastAPI、Viteでビルド

## セットアップ

### 必要環境

- Python 3.11+
- Node.js 18+
- Git
- tmux

### インストール

```bash
git clone https://github.com/kt0319/any-console.git
cd any-console
./any-console setup
```

依存インストール、フロントエンドビルド、`.env` の生成（トークン自動設定）をまとめて実行する。systemdサービスの登録もオプションで行える。

<details>
<summary>手動セットアップ</summary>

```bash
pip install -r requirements.txt
npm install
npm run build
```

```bash
cp .env.example .env
# .env を編集してトークンを設定
# ランダム生成: python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

</details>

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

FastAPIとVite dev serverを並列起動する。Ctrl+Cで両方終了。

### systemd（常時起動）

```bash
./any-console setup   # セットアップ時にsystemd登録を選択可
```

## ディレクトリ構成

```
api/              バックエンド (FastAPI)
  routers/        ルーター (workspaces, git, jobs, terminal, settings, system, logs)
  main.py         アプリ初期化、静的ファイル配信
  auth.py         Bearerトークン認証
  runner.py       ジョブ実行 (subprocess)
  config.py       config.json 読み書き
ui/               フロントエンド (Vue 3 + Pinia、Viteでビルド)
config.json       設定ファイル（自動生成、.gitignore対象）
```

## 設定

- ワークスペースの設定（アイコン、ジョブ定義、リンク等）は `config.json` に保存される
- 設定モーダルからエクスポート/インポートが可能

## オプション依存

- `gh` CLI - GitHubリポジトリ一覧の取得に使用（なくても動作する）

## ライセンス

[MIT](LICENSE)
