"""Rust 移行ブリッジ（/internal/git-nudge）のテスト。"""

from unittest.mock import patch

from fastapi.testclient import TestClient

from api.main import app

# ループバック接続元（既定の "testclient" ホストは loopback 判定にならないため明示）
loopback_client = TestClient(app, client=("127.0.0.1", 50000))
non_loopback_client = TestClient(app, client=("192.168.1.10", 50000))


def test_git_nudge_with_workspace_invalidates():
    with patch("api.routers.migration_bridge.invalidate_git_info") as invalidate:
        res = loopback_client.post("/internal/git-nudge", json={"workspace": "proj"})
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    invalidate.assert_called_once_with("proj")


def test_git_nudge_without_workspace_notifies_watch_set():
    with patch("api.routers.migration_bridge.notify_workspaces_changed") as notify:
        res = loopback_client.post("/internal/git-nudge", json={})
    assert res.status_code == 200
    notify.assert_called_once_with()


def test_git_nudge_empty_workspace_string_notifies_watch_set():
    with patch("api.routers.migration_bridge.notify_workspaces_changed") as notify:
        res = loopback_client.post("/internal/git-nudge", json={"workspace": ""})
    assert res.status_code == 200
    notify.assert_called_once_with()


def test_git_nudge_rejects_non_loopback():
    with patch("api.routers.migration_bridge.invalidate_git_info") as invalidate:
        res = non_loopback_client.post("/internal/git-nudge", json={"workspace": "proj"})
    assert res.status_code == 403
    assert res.json()["detail"] == "Loopback only"
    invalidate.assert_not_called()
