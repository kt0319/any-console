import subprocess

import pytest
from fastapi.testclient import TestClient

from api import auth as auth_module

TOKEN = "test-token"  # noqa: S105
auth_module.ANY_CONSOLE_TOKEN = TOKEN
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def find_ws_id(config: dict, display_name: str) -> str | None:
    """config.json から表示名で workspace ID を引く（ランタイム同様キー直接一致も許容）。"""
    for key, value in config.items():
        if key == "__global__" or not isinstance(value, dict):
            continue
        if key == display_name or value.get("name") == display_name:
            return key
    return None


def find_ws_entry(config: dict, display_name: str) -> dict | None:
    ws_id = find_ws_id(config, display_name)
    return config.get(ws_id) if ws_id else None


@pytest.fixture(autouse=True)
def isolate_fs(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    config_file = data / "config.json"

    import api.common as common_mod
    import api.config as config_mod
    import api.devices as devices_mod
    import api.routers.dispatch as dispatch_mod

    monkeypatch.setattr(common_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_mod, "CONFIG_FILE", config_file)
    # devices.json と server_key も tmp に隔離する（実ファイルへの書き込みを防ぐ）。
    monkeypatch.setattr(devices_mod, "_DEVICES_FILE", data / "devices.json")
    monkeypatch.setattr(devices_mod, "_SERVER_KEY_FILE", data / "server_key")
    monkeypatch.setattr(dispatch_mod, "DISPATCH_QUEUE_FILE", data / "dispatch_queue.json")

    return {"work": work, "data": data, "config_file": config_file}


@pytest.fixture()
def client():
    from api.main import app
    return TestClient(app)


@pytest.fixture()
def workspace(isolate_fs):
    ws = isolate_fs["work"] / "test-ws"
    ws.mkdir()
    import json

    from api.common import generate_entity_id
    config_file = isolate_fs["config_file"]
    config = json.loads(config_file.read_text(encoding="utf-8")) if config_file.is_file() else {}
    # 現行フォーマット（キー=ID、表示名は name フィールド）で書く
    ws_id = find_ws_id(config, "test-ws") or generate_entity_id()
    entry = config.setdefault(ws_id, {"name": "test-ws"})
    entry["path"] = str(ws)
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return ws


@pytest.fixture(autouse=True)
def _cleanup_terminal_sessions():
    """各テスト後にターミナルセッションをクリア"""
    yield
    from api.terminal_session import TERMINAL_SESSIONS, _kill_tmux_session, sessions_lock
    with sessions_lock:
        sessions = list(TERMINAL_SESSIONS.items())
        TERMINAL_SESSIONS.clear()
    for _, session in sessions:
        _kill_tmux_session(session)


@pytest.fixture(autouse=True)
def _reset_tailscale_trust(monkeypatch):
    """Tailscale ヘッダ信頼の opt-in キャッシュをテストごとにリセットする。

    デフォルト（環境変数なし・config なし）は無効 = ヘッダを信頼しない。
    """
    monkeypatch.delenv(auth_module.ENV_TRUST_TAILSCALE, raising=False)
    monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", None)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """各テスト前にレートリミッターのカウンターをリセット"""
    from api.rate_limiter import _counter
    _counter._counts.clear()


@pytest.fixture(autouse=True)
def _reset_jobs_cache():
    """各テスト前にジョブキャッシュをクリア"""
    from api.routers.jobs_common import _common_jobs_cache, _workspace_jobs_cache
    _workspace_jobs_cache.invalidate_all()
    _common_jobs_cache.invalidate_all()


@pytest.fixture()
def git_workspace(workspace):
    """git initされたワークスペース"""
    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=workspace, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=workspace, check=True, capture_output=True,
    )
    return workspace


@pytest.fixture()
def git_workspace_with_commit(git_workspace):
    """コミット済みのgitワークスペース"""
    (git_workspace / "README.md").write_text("# test\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=git_workspace, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=git_workspace, check=True, capture_output=True)
    return git_workspace
