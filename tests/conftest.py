import os
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("ANY_CONSOLE_TOKEN", "test-token")

TOKEN = os.environ["ANY_CONSOLE_TOKEN"]
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
    import api.routers.workspaces as workspaces_mod

    _work_dir = lambda: work
    monkeypatch.setattr(common_mod, "default_workspace_dir", _work_dir)
    monkeypatch.setattr(common_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_mod, "default_workspace_dir", _work_dir)
    monkeypatch.setattr(workspaces_mod, "default_workspace_dir", _work_dir)

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
    config_file = isolate_fs["config_file"]
    config = json.loads(config_file.read_text(encoding="utf-8")) if config_file.is_file() else {}
    config.setdefault("test-ws", {})["path"] = str(ws)
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return ws


@pytest.fixture(autouse=True)
def _cleanup_terminal_sessions():
    """各テスト後にターミナルセッションをクリア"""
    yield
    from api.routers.terminal import TERMINAL_SESSIONS, _kill_tmux_session, sessions_lock
    with sessions_lock:
        sessions = list(TERMINAL_SESSIONS.items())
        TERMINAL_SESSIONS.clear()
    for _, session in sessions:
        _kill_tmux_session(session)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """各テスト前にレートリミッターのカウンターをリセット"""
    from api.rate_limiter import _counter
    _counter._counts.clear()


@pytest.fixture(autouse=True)
def _reset_jobs_cache():
    """各テスト前にジョブキャッシュをクリア"""
    from api.routers.jobs import _workspace_jobs_cache
    _workspace_jobs_cache.invalidate_all()


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
