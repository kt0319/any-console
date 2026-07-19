"""api/routers/terminal.py のエンドポイント単体テスト。

既存の test_terminal_jobs.py がカバーしていないエラーパス・認証ガードを補完する。
"""
import subprocess
from unittest.mock import patch

from conftest import AUTH


class TestListSessions:
    def test_list_sessions_returns_list(self, client):
        res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_list_sessions_requires_auth(self, client):
        res = client.get("/terminal/sessions")
        assert res.status_code in (401, 403)

    def test_tmux_command_failure_returns_error_not_empty_list(self, client):
        # tmux コマンド自体が失敗（タイムアウト/OSError で None）し、一度も
        # スナップショットを構築できていない場合は「セッション0件」と誤解されない
        # よう空配列ではなくエラーを返す。
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 500

    def test_tmux_failure_serves_last_known_good(self, client):
        # 一度スナップショットが取れていれば、TTL 失効後の受動的な再構築が
        # 失敗しても最後に成功した一覧を返し続ける（タブの全消去・点滅を
        # 構造的に防ぐ）。TTL=0 で毎リクエスト再構築を強制する。
        listing = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="ac-lkg-test\t1700000000\n", stderr="")
        try:
            with patch("api.session_snapshot.SESSIONS_SNAPSHOT_TTL_SEC", 0.0):
                with patch("api.session_snapshot._run_tmux_cmd", return_value=listing), \
                     patch("api.terminal_session.load_tmux_metadata", return_value={}), \
                     patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
                    first = client.get("/terminal/sessions", headers=AUTH)
                assert [s["session_id"] for s in first.json()] == ["lkg-test"]
                with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
                    res = client.get("/terminal/sessions", headers=AUTH)
                assert res.status_code == 200
                assert [s["session_id"] for s in res.json()] == ["lkg-test"]
        finally:
            from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
            with sessions_lock:
                TERMINAL_SESSIONS.pop("lkg-test", None)

    def test_tmux_no_sessions_returns_empty_list(self, client):
        # tmux が正常応答した上での「セッション無し」（非ゼロ終了）は正当な空配列。
        no_sessions = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="no server running")
        with patch("api.session_snapshot._run_tmux_cmd", return_value=no_sessions):
            res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == []


class TestDeleteSession:
    def test_delete_nonexistent_session_returns_404(self, client):
        res = client.delete("/terminal/sessions/no-such-id", headers=AUTH)
        assert res.status_code == 404

    def test_delete_session_requires_auth(self, client):
        res = client.delete("/terminal/sessions/whatever")
        assert res.status_code in (401, 403)


class TestSessionFiles:
    SESSION_ID = "files-test"
    TMUX_NAME = "ac-files-test"

    def _register_session(self, cwd, monkeypatch) -> None:
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock

        session = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        with sessions_lock:
            TERMINAL_SESSIONS[self.SESSION_ID] = session
        monkeypatch.setattr("api.routers.terminal.get_session_cwd", lambda name: str(cwd))

    def test_list_files_from_terminal_cwd(self, client, tmp_path, monkeypatch):
        cwd = tmp_path / "plain"
        cwd.mkdir()
        (cwd / "docs").mkdir()
        (cwd / "note.txt").write_text("hello", encoding="utf-8")
        self._register_session(cwd, monkeypatch)

        res = client.get(f"/terminal/sessions/{self.SESSION_ID}/files", headers=AUTH)

        assert res.status_code == 200
        data = res.json()
        assert data["path"] == ""
        assert [e["name"] for e in data["entries"]] == ["docs", "note.txt"]

    def test_read_file_from_terminal_cwd(self, client, tmp_path, monkeypatch):
        cwd = tmp_path / "plain"
        cwd.mkdir()
        (cwd / "note.txt").write_text("hello", encoding="utf-8")
        self._register_session(cwd, monkeypatch)

        res = client.get(
            f"/terminal/sessions/{self.SESSION_ID}/file-content",
            headers=AUTH,
            params={"path": "note.txt"},
        )

        assert res.status_code == 200
        assert res.json()["content"] == "hello"

    def test_terminal_cwd_files_rejects_path_escape(self, client, tmp_path, monkeypatch):
        cwd = tmp_path / "plain"
        cwd.mkdir()
        self._register_session(cwd, monkeypatch)

        res = client.get(
            f"/terminal/sessions/{self.SESSION_ID}/files",
            headers=AUTH,
            params={"path": ".."},
        )

        assert res.status_code == 400


class TestHistoryRestore:
    """history は xterm と同じ幅で capture できる時だけスクロールバックを返す。

    幅が食い違ったまま capture すると、誤った幅で wrap された内容をクライアントが
    書き戻して全スクロールバックが崩れる（ADR 16 の直接アタッチ構成での回帰）。
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
            session.bridges[object()] = ClientBridge(fd=None, pid=None)
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


class TestWsTmuxTransientFailure:
    """tmux コマンド一時失敗時に WS がセッションを「不在」と誤判定しないことを確認する。

    誤って 1008（Session not found）で閉じると、クライアントがタブを閉じて
    生きているセッションを失うため、再接続可能な 1011 で閉じる必要がある。
    """

    SESSION_ID = "ws-transient-test"

    def _register_session(self):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(workspace=None, tmux_session_name=f"ac-{self.SESSION_ID}")
        with sessions_lock:
            TERMINAL_SESSIONS[self.SESSION_ID] = session
        return session

    def test_registered_session_transient_failure_closes_1011_and_keeps_registry(self, client):
        import pytest
        from starlette.websockets import WebSocketDisconnect

        from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
        from conftest import TOKEN

        self._register_session()
        with patch("api.routers.terminal.has_tmux_session", return_value=None):
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(
                    f"/terminal/ws/{self.SESSION_ID}?token={TOKEN}"
                ) as ws:
                    ws.receive_bytes()
        assert exc_info.value.code == 1011
        # 一時失敗では registry からセッションを破棄しない
        with sessions_lock:
            assert self.SESSION_ID in TERMINAL_SESSIONS

    def test_unregistered_session_transient_failure_closes_1011(self, client):
        import pytest
        from starlette.websockets import WebSocketDisconnect

        from conftest import TOKEN

        with patch("api.routers.terminal.has_tmux_session", return_value=None):
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(
                    f"/terminal/ws/{self.SESSION_ID}-unreg?token={TOKEN}"
                ) as ws:
                    ws.receive_bytes()
        assert exc_info.value.code == 1011

    def test_unregistered_session_definitely_missing_closes_1008(self, client):
        import pytest
        from starlette.websockets import WebSocketDisconnect

        from conftest import TOKEN

        with patch("api.routers.terminal.has_tmux_session", return_value=False):
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(
                    f"/terminal/ws/{self.SESSION_ID}-missing?token={TOKEN}"
                ) as ws:
                    ws.receive_bytes()
        assert exc_info.value.code == 1008


class TestGetSessionTransientFailure:
    """get_terminal_session 経由のエンドポイントが tmux 一時失敗を 404 と区別することを確認する。"""

    def test_history_returns_500_on_transient_tmux_failure(self, client):
        # 404 を返すとクライアントが「セッション消滅」と誤解し得るため 500 で区別する。
        with patch("api.terminal_session.has_tmux_session", return_value=None):
            res = client.get("/terminal/sessions/nonexistent-transient/history", headers=AUTH)
        assert res.status_code == 500

    def test_history_returns_404_when_definitely_missing(self, client):
        with patch("api.terminal_session.has_tmux_session", return_value=False):
            res = client.get("/terminal/sessions/nonexistent-gone/history", headers=AUTH)
        assert res.status_code == 404


class TestRestoreMetadataUnavailable:
    """tmux メタデータが読めない間は不完全な登録をしないことを確認する。

    workspace 無しで registry にキャッシュされると、ワークスペースセッションが
    素のターミナルに化けたまま固定される。読めない間はセッション解決自体を
    「一時失敗」（500 / WS 1011 / スナップショット last-known-good）に倒す。
    """

    TMUX_NAME = "ac-meta-test"

    def test_from_tmux_returns_none_when_metadata_unavailable(self):
        from api.terminal_session import TerminalSession
        with patch("api.terminal_session.load_tmux_metadata", return_value=None):
            assert TerminalSession.from_tmux(self.TMUX_NAME) is None

    def test_from_tmux_empty_metadata_is_plain_terminal(self):
        # tmux が正常応答した上での「メタデータ無し」（素のターミナル）は正当。
        from api.terminal_session import TerminalSession
        with patch("api.terminal_session.load_tmux_metadata", return_value={}), \
             patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
            sess = TerminalSession.from_tmux(self.TMUX_NAME)
        assert sess is not None
        assert sess.workspace is None

    def test_get_terminal_session_returns_500_when_metadata_unavailable(self, client):
        # 404 にするとクライアントが「セッション消滅」と誤解するため 500 で区別する。
        with patch("api.terminal_session.has_tmux_session", return_value=True), \
             patch("api.terminal_session.load_tmux_metadata", return_value=None):
            res = client.get("/terminal/sessions/meta-test/history", headers=AUTH)
        assert res.status_code == 500

    def test_ws_closes_1011_when_metadata_unavailable(self, client):
        import pytest
        from starlette.websockets import WebSocketDisconnect

        from conftest import TOKEN

        with patch("api.routers.terminal.has_tmux_session", return_value=True), \
             patch("api.terminal_session.load_tmux_metadata", return_value=None):
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect(
                    f"/terminal/ws/meta-test?token={TOKEN}"
                ) as ws:
                    ws.receive_bytes()
        assert exc_info.value.code == 1011
