"""api/routers/terminal.py のエンドポイント単体テスト。

既存の test_terminal_jobs.py がカバーしていないエラーパス・認証ガードを補完する。
"""
from conftest import AUTH


class TestListSessions:
    def test_list_sessions_returns_list(self, client):
        res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_list_sessions_requires_auth(self, client):
        res = client.get("/terminal/sessions")
        assert res.status_code in (401, 403)


class TestDeleteSession:
    def test_delete_nonexistent_session_returns_404(self, client):
        res = client.delete("/terminal/sessions/no-such-id", headers=AUTH)
        assert res.status_code == 404

    def test_delete_session_requires_auth(self, client):
        res = client.delete("/terminal/sessions/whatever")
        assert res.status_code in (401, 403)
