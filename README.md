# pi-console

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブを実行する。

## セットアップ

```bash
pip install fastapi uvicorn
chmod +x jobs/*.sh
```

## 起動

```bash
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
api/          API (FastAPI)
ui/           Web UI (静的ファイル)
jobs/         ジョブスクリプト
systemd/      systemdサービス定義
```

## API

```
POST /run
Authorization: Bearer <token>

{"job": "deploy", "args": {"env": "stg", "service": "api"}}
→ {"status": "ok", "exit_code": 0, "stdout": "...", "stderr": ""}
```
