"""Rust 移行ブリッジ（/internal/*）のテスト。"""

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


def test_session_event_created_notifies_session_watch():
    with patch("api.routers.migration_bridge.notify_session_created") as notify:
        res = loopback_client.post("/internal/session-event", json={"event": "created", "session_id": "abc"})
    assert res.status_code == 200
    notify.assert_called_once_with("abc")


def test_session_event_removed_clears_hooks_and_notifies():
    with (
        patch("api.routers.migration_bridge.clear_session") as clear,
        patch("api.routers.migration_bridge.notify_session_removed") as notify,
    ):
        res = loopback_client.post("/internal/session-event", json={"event": "removed", "session_id": "abc"})
    assert res.status_code == 200
    clear.assert_called_once_with("abc")
    notify.assert_called_once_with("abc")


def test_session_event_unknown_event_rejected():
    res = loopback_client.post("/internal/session-event", json={"event": "bogus", "session_id": "abc"})
    assert res.status_code == 403


def test_session_event_rejects_non_loopback():
    res = non_loopback_client.post("/internal/session-event", json={"event": "created", "session_id": "abc"})
    assert res.status_code == 403


def test_send_push_invokes_notification():
    with patch("api.routers.migration_bridge.send_push_notification") as send:
        res = loopback_client.post(
            "/internal/send-push",
            json={"title": "T", "body": "B", "url": "/x", "notif_type": "dispatch"},
        )
    assert res.status_code == 200
    send.assert_called_once_with("T", "B", url="/x", notif_type="dispatch")


def test_send_push_rejects_non_loopback():
    res = non_loopback_client.post("/internal/send-push", json={"title": "T", "body": "B"})
    assert res.status_code == 403


def test_dispatch_queue_relay_sets_bridged_payload():
    payload = {"type": "dispatch_queue", "items": [{"id": "d1"}], "recent": []}
    with patch("api.routers.dispatch.set_bridged_payload") as setter:
        res = loopback_client.post("/internal/dispatch-queue", json=payload)
    assert res.status_code == 200
    setter.assert_called_once_with(payload)


def test_dispatch_queue_relay_rejects_non_loopback():
    res = non_loopback_client.post("/internal/dispatch-queue", json={})
    assert res.status_code == 403


def test_verify_dispatch_api_token_valid_scoped_token():
    with patch("api.routers.migration_bridge._verify_api_token") as verify:
        verify.return_value = {"id": "tok_1", "scope": "dispatch"}
        res = loopback_client.post("/internal/verify-dispatch-api-token", json={"token": "raw"})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "label": "token:tok_1"}
    verify.assert_called_once_with("raw")


def test_verify_dispatch_api_token_wrong_scope_rejected():
    with patch("api.routers.migration_bridge._verify_api_token") as verify:
        verify.return_value = {"id": "tok_1", "scope": "other"}
        res = loopback_client.post("/internal/verify-dispatch-api-token", json={"token": "raw"})
    assert res.status_code == 200
    assert res.json() == {"ok": False, "label": None}


def test_verify_dispatch_api_token_unknown_rejected():
    with patch("api.routers.migration_bridge._verify_api_token") as verify:
        verify.return_value = None
        res = loopback_client.post("/internal/verify-dispatch-api-token", json={"token": "bad"})
    assert res.status_code == 200
    assert res.json() == {"ok": False, "label": None}


def test_verify_dispatch_api_token_rejects_non_loopback():
    res = non_loopback_client.post("/internal/verify-dispatch-api-token", json={"token": "x"})
    assert res.status_code == 403
