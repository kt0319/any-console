import os
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("PI_CONSOLE_TOKEN", "test-token")

TOKEN = os.environ["PI_CONSOLE_TOKEN"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def isolate_fs(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    config_file = data / "config.json"

    import api.common as common_mod
    import api.config as config_mod
    import api.routers.settings as settings_mod
    import api.routers.workspaces as workspaces_mod

    monkeypatch.setattr(common_mod, "WORK_DIR", work)
    monkeypatch.setattr(common_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(settings_mod, "WORK_DIR", work)
    monkeypatch.setattr(workspaces_mod, "WORK_DIR", work)

    return {"work": work, "data": data, "config_file": config_file}


@pytest.fixture()
def client():
    from api.main import app
    return TestClient(app)


@pytest.fixture()
def workspace(isolate_fs):
    ws = isolate_fs["work"] / "test-ws"
    ws.mkdir()
    return ws


@pytest.fixture(autouse=True)
def _cleanup_terminal_sessions():
    """各テスト後にターミナルセッションをクリア"""
    yield
    from api.routers.terminal import TERMINAL_SESSIONS, _kill_pty_session, _sessions_lock
    with _sessions_lock:
        sessions = list(TERMINAL_SESSIONS.items())
        TERMINAL_SESSIONS.clear()
    for _, session in sessions:
        _kill_pty_session(session)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """各テスト前にレートリミッターのカウンターをリセット"""
    from api.rate_limiter import _counter
    _counter._counts.clear()


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
