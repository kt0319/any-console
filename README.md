# pi-console

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブ実行、Git操作、Webターミナルを提供する。UIはモバイルファースト、PCにも対応。

## セットアップ

```bash
pip install fastapi uvicorn websockets python-dotenv
```

## 起動

```bash
# .envがある場合はTOKEN指定不要
python -m uvicorn api.main:app --host 0.0.0.0 --port 8888 --reload

# .envがない場合はTOKENを明示指定
PI_CONSOLE_TOKEN=your-secret-token python -m uvicorn api.main:app --host 0.0.0.0 --port 8888
```

ブラウザで `http://localhost:8888` を開く。

## systemd

```bash
# .env を作成
echo "PI_CONSOLE_TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" > .env

# サービス登録
sudo cp systemd/pi-console.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-console
```

## ディレクトリ構成

```
api/              API (FastAPI)
  routers/        ルーター (workspaces, git, jobs, terminal, settings, system, logs)
  main.py         アプリ初期化、静的ファイル配信
  auth.py         Bearerトークン認証
  runner.py       ジョブ実行 (subprocess)
  jobs.py         ジョブ定義 (dataclass)
  common.py       共通定数、TTLCache、LogBuffer
  config.py       config.json 読み書き・ロック管理
  config_schema.py  config.json スキーマ定義 (Pydantic)
  git_utils.py    Gitコマンド実行ユーティリティ
ui/               Web UI (バニラJS、ビルド不要)
systemd/          systemdサービス定義
config.json       設定ファイル (.gitignore対象)
```

## ジョブシステム

ジョブはUIから作成・編集・削除が可能。定義は `config.json` にワークスペースごとに保存される。

## 設定

設定は `config.json` に統合管理される。設定モーダルからエクスポート/インポートが可能。
