# CLAUDE.md / AGENTS.md

このファイルは、このリポジトリで作業するコーディングエージェント向けの共通ガイドです。
`CLAUDE.md` / `AGENTS.md` のどちらで参照されても同じ内容を適用します。

---

# プロジェクト概要

Web操作コンソール。
スマホから Tailscale 経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。

UIは **モバイルファースト** で設計しつつ、**PCでもシームレスに使える** ことを目指す。

- 同一URL
- 同一機能
- 画面サイズや入力デバイスに応じた自然な最適化

を提供する。

---

# 動作環境

- 本番:
  - Linux + systemd + tmux + journalctl
  - Debian 系ディストリビューション想定

- 開発・検証:
  - macOS
  - Linux

OS固有機能の追加は最小限にする（クロスプラットフォームで動く方を優先する）が、本番運用は Linux + systemd + tmux 環境を前提とする。

---

# 依存関係

- Python 3.11+
- Node.js 18+

## Python

主要ライブラリ:

- `fastapi`
- `uvicorn`
- `websockets`
- `pydantic`
- `python-multipart`

## Frontend

- `vite`
- `vue`
- `pinia`
- `@xterm/xterm`
- `highlight.js`
- `@mdi/font`

## 開発依存（Backend）

- `pytest`
- `pytest-cov`
- `ruff`
- `mypy`
- `httpx`

## 開発依存（Frontend）

- `vitest`
- `@vitest/coverage-v8`
- `@vitejs/plugin-vue`
- `happy-dom`（未導入、コンポーネントテストが必要になった場合に追加）

## 追加ツール

### tmux

ターミナルセッション管理に必須。

### gh CLI（任意）

GitHubリポジトリ一覧・Issue・PR・Actions取得に使用。

---

# 起動・開発

すべての運用操作は `./any-console <subcommand>` から行う。

```bash
./any-console setup
./any-console update

./any-console start
./any-console stop
./any-console restart

./any-console status
./any-console logs
./any-console version
```

## 本番（systemd）

```bash
npm run build
sudo systemctl restart any-console
```

または:

```bash
./any-console restart
```

## Docker

```bash
docker compose -f docker/compose.yml up -d
```

## dist 配信ルール

- `dist/` が存在する場合:
  - `dist/` を配信

- 存在しない場合:
  - `ui/` を直接配信

---

# 認証

デフォルトは **自動生成トークンで認証有効**。

初回起動時に `data/auth.json` が存在しない場合、32文字のランダムトークンを生成して保存し、
接続用 URL を標準出力と journalctl に1回だけ表示する:

```
any-console: Auth token (open this URL on your device):
  http://<host>:8888/?token=xxxxx
```

二回目以降の起動では `data/auth.json` を上書きしない。

## 認証無効化

Tailscale 等の閉域ネットワーク前提で意図的に無効化する場合:

- 環境変数: `ANY_CONSOLE_DISABLE_AUTH=1`
- または `config.json` に `"auth_disabled": true`

いずれかが設定されている場合、トークン自動生成をスキップし認証なしで起動する。

保存先:

```text
data/auth.json
```

## 認証方式

- Bearer Token
- WebSocket は `verify_ws_token()` で検証

---

# テスト・Lint

## Backend

```bash
pytest
```

Coverage:

```bash
pytest --cov
```

## Frontend

```bash
npm test
```

Coverage:

```bash
npm run test:coverage
```

## フロントエンドテスト方針

- テスト対象の純粋関数は `ui/utils/` に切り出して実装する
- テストは実ファイルを `import` して検証する（インラインコピー禁止）
- コンポーネント自体（DOM依存）のテストは行わない
- 新たに追加する純粋関数は最初から `ui/utils/` に置く
- 既存のインラインコピーは機会があれば順次 `import` 方式に移行する

## Lint

```bash
ruff check api/
```

## 型チェック

```bash
mypy
```

## CI

- `.github/workflows/ci.yml`
- codecov 連携

---

# アーキテクチャ

詳細は:

```text
docs/ARCHITECTURE.md
```

を参照。

---

# Backend

```text
api/
```

## 主なモジュール

### main.py

- アプリ初期化
- `/auth/check`
- 画像アップロード
- 静的ファイル配信

### auth.py

- トークン認証
- 信頼Proxy判定

### runner.py

- ジョブ実行（subprocess、デフォルトタイムアウト 300秒（ジョブごとに timeout_sec で上書き可能））

### terminal_session.py / tmux.py

- tmux
- pty.fork
- WebSocket bridge

### git_utils.py / git_lock.py

- Git subprocess 実行
- workspace lock

### config.py / config_schema.py

- config.json
- Pydantic validation

---

# Router

```text
api/routers/
```

- workspaces
- jobs
- terminal
- system
- settings
- git
- github

---

# Frontend

```text
ui/
```

- Vue 3
- Pinia
- Vite

## 主な構成

- components
- stores
- composables
- utils
- styles

PWA対応あり。

---

# ジョブシステム

ジョブ定義は `config.json` に統合管理。

## 各ジョブ

- command
- label
- description
- icon
- icon_color
- confirm
- hidden_tab

## 実行

- subprocess
- デフォルトタイムアウト 300秒（ジョブごとに `timeout_sec` で上書き可能、上限 86400 秒）

---

# ワークスペース

ワークスペースは既存ディレクトリのフルパスを登録する。

Workspace Settings 上部の入力欄にパスを入力するとサジェストが表示される。

サジェスト初期位置:

```python
Path.home()
```

## Pull / Push

`pull` / `push` 成功時はトーストに以下を表示する。

- 受信/送信したコミット件数
- 直近 3 件のコミットメッセージ
- 超過分は `… and N more` 表記

---

# ターミナル

## セッション管理

tmux ベース。

- 1タブ = 1 tmux session

## 特徴

- ブラウザを閉じても tmux session は残る
- 再接続可能
- timeout 無し

## 管理

```python
TERMINAL_SESSIONS
```

でインメモリ管理。

---

# UIルール

## 基本方針

モバイルファースト。

ただし PC でも同等機能を提供する。

## 画面設計

- 広い画面では情報密度を上げる
- 無意味な余白を増やさない

## 入力デバイス

### PC

- keyboard shortcut
- hover
- right click

を活用可能。

### Mobile

- tap
- swipe

を基本とする。

## タップターゲット

- 推奨:
  - 44x44 px

- 最低:
  - 24x24 px

24px を使う場合:

- 10px 以上の余白を確保

---

# Confirm Rules

破壊的操作は必ず確認ダイアログを挟む。

対象例:

- file delete
- branch delete
- commit 破棄 / reset --hard
- stash drop
- force push
- terminal session close
- 設定リセット
- token revoke

## 実装

必ず:

```js
useConfirm()
```

を使う。

禁止:

```js
window.confirm()
```

## メッセージ

英語で記述。

何が起きるかを明示する。

例:

```text
Delete file "foo.txt"? This cannot be undone.
```

影響が特に大きい操作（force push、全消去など）は、対象名の入力など追加の確認ステップを検討する。

---

# CSSルール

## hover

hover は PC のみ。

```css
@media (hover: hover) and (pointer: fine)
```

で guard する。

## Clickable

クリック可能要素は:

- background
- border

などで視覚区別する。

下線リンク風は使わない。

## 状態変化

JS class 切替で表現。

例:

- `.active`
- `.selected`

## backdrop-filter

使用禁止。

---

# Frontend設計ルール

## API endpoint

ハードコード禁止。

必ず:

```js
ui/utils/endpoints.js
```

を使用。

## timer

`setTimeout` / `setInterval` 等の時間値、ブレークポイント等の数値定数は:

```js
ui/utils/constants.js
```

へ定義。直書き禁止。

## API error

優先:

```js
apiGet(..., {
  errorMessage: "..."
})
```

非推奨:

```js
emit("toast:show")
```

## Component size

300行超のコンポーネントは責務分離を検討する。

- composables 抽出を優先

ただし:

- 単純な template 増加
- 明確にまとまった責務

による増加は許容する。

---

# Backend APIルール

## Error field

エラーフィールドは:

```json
detail
```

を使用。

`message` は使わない。

## Exception

裸の:

```python
except Exception
```

は禁止。

具体的例外を指定する。

## subprocess

失敗時は:

```python
OSError
```

も捕捉する。

---

# 設計上の注意点

- Git操作は subprocess のみ
- Git library 不使用

- 認証は単一 token
- user distinction 無し

- **単一プロセスのみ**。`_acquire_singleton_lock` により `uvicorn --workers > 1` は拒否される（ターミナルセッション・レートリミッタ・TTLキャッシュ等をプロセス内状態で保持しているため）

- `dist/` が存在する場合は `dist/` 配信
- 無い場合は `ui/` を配信

- CSS / JS には cache bust query を付与

- systemd service は `any-console` が生成

- Docker:
  - `docker/Dockerfile`
  - `docker/compose.yml`

- `AGENTS.md` は `CLAUDE.md` の symlink

- `data/auth.json`
- `config.json`
- `config.bak`

は `.gitignore` 対象

---

# エージェント向け方針

既存設計・命名・UIトーンを優先すること。

不要な:

- 大規模リファクタリング
- 設計変更
- 命名変更
- UI思想変更

は行わない。

既存コードとの整合性を重視する。
