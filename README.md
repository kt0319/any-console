# any-console

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
pip install -r requirements.txt
npm install
npm run build
```

### 認証トークンの設定

```bash
cp .env.example .env
# .env を編集してトークンを設定
# ランダム生成: python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

### 起動

```bash
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888
```

ブラウザで `http://localhost:8888` を開く。

#### 開発モード

```bash
# 1. FastAPI（API側）
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload --reload-include "*.py"

# 2. Vite dev server（別ターミナル）
npm run dev
# → localhost:5173 にアクセス（APIはプロキシで8888に転送）
```

### systemd（常時起動）

```bash
# サービスファイルを編集（%USER% と %INSTALL_DIR% を置換）
sudo cp systemd/any-console.service /etc/systemd/system/
sudo vim /etc/systemd/system/any-console.service

sudo systemctl daemon-reload
sudo systemctl enable --now any-console
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
systemd/          systemdサービス定義
config.json       設定ファイル（自動生成、.gitignore対象）
```

## 設定

- ワークスペースの設定（アイコン、ジョブ定義、リンク等）は `config.json` に保存される
- 設定モーダルからエクスポート/インポートが可能

## オプション依存

- `gh` CLI - GitHubリポジトリ一覧の取得に使用（なくても動作する）

## ライセンス

[MIT](LICENSE)
