"""全エンドポイントの認証ガードテスト。

認証ヘッダなしリクエストが 401/403 を返すことを確認する。
ルーター追加・変更時の認証漏れを即検出する。
"""

import pytest


ENDPOINTS = [
    ("GET", "/auth/check"),
    ("POST", "/upload-image"),
    # workspaces
    ("GET", "/workspaces"),
    ("GET", "/workspaces/statuses"),
    ("PUT", "/workspace-order"),
    ("PUT", "/workspaces/test-ws/config"),
    ("POST", "/workspaces"),
    # github
    ("GET", "/github/repos"),
    ("GET", "/workspaces/test-ws/github/info"),
    ("GET", "/workspaces/test-ws/github/issues"),
    ("GET", "/workspaces/test-ws/github/pulls"),
    # git refs
    ("GET", "/workspaces/test-ws/status"),
    ("GET", "/workspaces/test-ws/branches"),
    ("GET", "/workspaces/test-ws/branches/remote"),
    ("POST", "/workspaces/test-ws/delete-branch"),
    ("POST", "/workspaces/test-ws/create-branch"),
    ("POST", "/workspaces/test-ws/checkout"),
    ("POST", "/workspaces/test-ws/pull"),
    ("POST", "/workspaces/test-ws/push"),
    ("POST", "/workspaces/test-ws/set-upstream"),
    ("POST", "/workspaces/test-ws/push-upstream"),
    ("POST", "/workspaces/test-ws/fetch"),
    # git history
    ("GET", "/workspaces/test-ws/git-log"),
    ("POST", "/workspaces/test-ws/cherry-pick"),
    ("POST", "/workspaces/test-ws/revert"),
    ("POST", "/workspaces/test-ws/reset"),
    ("POST", "/workspaces/test-ws/commit"),
    ("GET", "/workspaces/test-ws/stash-list"),
    ("POST", "/workspaces/test-ws/stash"),
    ("POST", "/workspaces/test-ws/stash-pop"),
    ("POST", "/workspaces/test-ws/stash-pop-ref"),
    ("POST", "/workspaces/test-ws/stash-drop"),
    # git diff
    ("GET", "/workspaces/test-ws/diff"),
    ("GET", "/workspaces/test-ws/diff/abcd1234"),
    # git files
    ("GET", "/workspaces/test-ws/files"),
    ("GET", "/workspaces/test-ws/file-content"),
    ("POST", "/workspaces/test-ws/upload"),
    ("POST", "/workspaces/test-ws/rename"),
    ("POST", "/workspaces/test-ws/delete-file"),
    ("GET", "/workspaces/test-ws/download"),
    # jobs
    ("GET", "/workspaces/test-ws/jobs"),
    ("GET", "/workspaces/test-ws/jobs/job_test"),
    ("POST", "/workspaces/test-ws/jobs"),
    ("PUT", "/workspaces/test-ws/job-order"),
    ("PUT", "/workspaces/test-ws/jobs/job_test"),
    ("DELETE", "/workspaces/test-ws/jobs/job_test"),
    ("POST", "/run"),
    # terminal
    ("GET", "/terminal/sessions"),
    ("DELETE", "/terminal/sessions/dummy"),
    # settings
    ("GET", "/settings/export"),
    ("POST", "/settings/import"),
    ("GET", "/snippets"),
    ("PUT", "/snippets"),
    # system
    ("GET", "/system/processes"),
    ("GET", "/system/info"),
    # logs
    ("GET", "/logs"),
    ("DELETE", "/logs"),
    ("GET", "/op-logs"),
    ("DELETE", "/op-logs"),
    ("POST", "/logs/client"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS, ids=[f"{m} {p}" for m, p in ENDPOINTS])
def test_unauthenticated_returns_401(client, method, path):
    """認証ヘッダなしリクエストは 401 を返す"""
    dispatch = {
        "GET": client.get,
        "POST": client.post,
        "PUT": client.put,
        "DELETE": client.delete,
    }
    res = dispatch[method](path)
    assert res.status_code in (401, 403), (
        f"{method} {path} returned {res.status_code}, expected 401 or 403"
    )
