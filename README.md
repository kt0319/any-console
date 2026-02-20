# pi-console

Raspberry Pi用Web操作コンソール。スマホからTailscale経由でシェルスクリプトのジョブを実行する。

## セットアップ

```bash
pip install fastapi uvicorn websockets
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

## Workspace別のjobs設定

各Workspace直下に `.pi-console-jobs.json` を置くと、そのWorkspaceで表示/実行できるjobを制限できます。

例:

```json
{
  "jobs": ["status", "docker"]
}
```

または配列形式でも指定できます。

```json
["status", "docker"]
```

`terminal` を有効化する場合の例:

```json
{
  "jobs": ["status", "docker", "terminal"]
}
```

## 一時Webターミナル（ttyd）

### 依存

```bash
sudo apt install ttyd
```

### 制限ユーザー作成

```bash
sudo useradd -m terminal
```

`terminal` ユーザーには sudo 権限を付与しないでください。

### sudoers（pi-console 実行ユーザーから terminal で ttyd 実行）

`pi` ユーザーで動かす場合の例:

```bash
echo 'pi ALL=(terminal) NOPASSWD: /usr/bin/timeout 600 /usr/bin/ttyd *' | sudo tee /etc/sudoers.d/pi-console-terminal
sudo chmod 440 /etc/sudoers.d/pi-console-terminal
```

この設定がない場合、`terminal` ジョブは `sudo` で失敗します。
