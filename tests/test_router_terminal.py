"""api/routers/terminal.py のエンドポイント単体テスト。

既存の test_terminal_jobs.py がカバーしていないエラーパス・認証ガードを補完する。
"""
import subprocess

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


class TestHistoryRestore:
    """history は xterm と同じ幅で capture できる時だけスクロールバックを返す。

    幅が食い違ったまま capture すると、誤った幅で wrap された内容をクライアントが
    書き戻して全スクロールバックが崩れる（ADR 15 の grouped session 構成での回帰）。
    """

    SESSION_ID = "hist-test"
    TMUX_NAME = "ac-hist-test"

    def _register_session(self, *, with_bridge: bool) -> None:
        from api.terminal_session import (
            TERMINAL_SESSIONS,
            ClientBridge,
            TerminalSession,
            sessions_lock,
        )
        session = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        if with_bridge:
            session.bridges[object()] = ClientBridge(fd=None, pid=None, grouped_name=None)
        with sessions_lock:
            TERMINAL_SESSIONS[self.SESSION_ID] = session

    def _patch_tmux(self, monkeypatch, calls: list) -> None:
        def fake_run(cmd, **kwargs):
            calls.append(list(cmd))
            if "capture-pane" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="line1\nline2", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        monkeypatch.setattr("api.routers.terminal.subprocess.run", fake_run)

    def test_no_bridges_resizes_and_restores_window_size_latest(self, client, monkeypatch):
        """誰も接続していなければ resize して capture し、window-size latest を復元する"""
        self._register_session(with_bridge=False)
        calls = []
        self._patch_tmux(monkeypatch, calls)

        res = client.get(f"/terminal/sessions/{self.SESSION_ID}/history?cols=45&rows=96", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["content"] == "line1\r\nline2"

        resize_calls = [c for c in calls if "resize-window" in c]
        assert len(resize_calls) == 1
        # resize-window は window-size を manual に書き換えるため、同じ呼び出しで latest に戻す
        assert "set-option" in resize_calls[0]
        assert "latest" in resize_calls[0]

    def test_bridge_with_mismatched_width_skips_restore(self, client, monkeypatch):
        """別クライアント接続中に幅が合わない場合は崩れた内容を返さずスキップする"""
        self._register_session(with_bridge=True)
        calls = []
        self._patch_tmux(monkeypatch, calls)
        monkeypatch.setattr("api.routers.terminal.get_window_width", lambda name: 200)

        res = client.get(f"/terminal/sessions/{self.SESSION_ID}/history?cols=45&rows=96", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["content"] == ""
        assert not any("resize-window" in c for c in calls)
        assert not any("capture-pane" in c for c in calls)

    def test_bridge_with_matching_width_captures_without_resize(self, client, monkeypatch):
        """別クライアント接続中でも幅が一致していればそのまま capture する"""
        self._register_session(with_bridge=True)
        calls = []
        self._patch_tmux(monkeypatch, calls)
        monkeypatch.setattr("api.routers.terminal.get_window_width", lambda name: 45)

        res = client.get(f"/terminal/sessions/{self.SESSION_ID}/history?cols=45&rows=96", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["content"] == "line1\r\nline2"
        assert not any("resize-window" in c for c in calls)

    def test_no_dims_captures_without_resize(self, client, monkeypatch):
        """cols/rows 未指定なら従来どおり resize せず capture する"""
        self._register_session(with_bridge=False)
        calls = []
        self._patch_tmux(monkeypatch, calls)

        res = client.get(f"/terminal/sessions/{self.SESSION_ID}/history", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["content"] == "line1\r\nline2"
        assert not any("resize-window" in c for c in calls)
