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
        # 一度スナップショットが取れていれば、以後の tmux 一時失敗では
        # 最後に成功した一覧を返し続ける（タブの全消去・点滅を構造的に防ぐ）。
        from api.session_snapshot import invalidate_sessions_snapshot
        listing = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="ac-lkg-test\t1700000000\n", stderr="")
        with patch("api.session_snapshot._run_tmux_cmd", return_value=listing), \
             patch("api.terminal_session.load_tmux_metadata", return_value={}), \
             patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
            first = client.get("/terminal/sessions", headers=AUTH)
        assert [s["session_id"] for s in first.json()] == ["lkg-test"]
        try:
            invalidate_sessions_snapshot()
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


class TestRestoreWorkspaceSelfHeal:
    """リストア時に tmux メタデータ読み込みが一時失敗しても、ワークスペース
    セッションが素のターミナルとして固定されないことを確認する。

    load_tmux_metadata の一時失敗（None）を「メタデータ無し」と混同すると
    workspace 無しでレジストリにキャッシュされ、サーバ再起動まで直らない。
    from_tmux は 1 回だけ再試行し、それでも失敗なら meta_incomplete を立てて
    後続アクセスで自己回復させる。
    """

    SESSION_ID = "heal-test"
    TMUX_NAME = "ac-heal-test"

    def _pop_registry(self):
        from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
        with sessions_lock:
            TERMINAL_SESSIONS.pop(self.SESSION_ID, None)

    def test_from_tmux_retries_transient_metadata_failure(self):
        from api.terminal_session import TerminalSession
        with patch("api.terminal_session.load_tmux_metadata",
                   side_effect=[None, {"TMUX_WORKSPACE": "ws1"}]) as load:
            sess = TerminalSession.from_tmux(self.TMUX_NAME)
        assert load.call_count == 2
        assert sess.workspace == "ws1"
        assert sess.meta_incomplete is False

    def test_from_tmux_marks_incomplete_when_metadata_unavailable(self):
        from api.terminal_session import TerminalSession
        with patch("api.terminal_session.load_tmux_metadata", return_value=None), \
             patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
            sess = TerminalSession.from_tmux(self.TMUX_NAME)
        assert sess.workspace is None
        assert sess.meta_incomplete is True

    def test_from_tmux_empty_metadata_is_not_incomplete(self):
        # tmux が正常応答した上での「メタデータ無し」（素のターミナル）は正当。
        from api.terminal_session import TerminalSession
        with patch("api.terminal_session.load_tmux_metadata", return_value={}), \
             patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
            sess = TerminalSession.from_tmux(self.TMUX_NAME)
        assert sess.workspace is None
        assert sess.meta_incomplete is False

    def test_refresh_heals_workspace_and_clears_flag(self):
        from api.terminal_session import TerminalSession
        sess = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        sess.meta_incomplete = True
        with patch("api.terminal_session.load_tmux_metadata",
                   return_value={"TMUX_WORKSPACE": "ws1", "TMUX_DETACHED": "1"}):
            sess.refresh_metadata_if_incomplete()
        assert sess.workspace == "ws1"
        assert sess.detached is True
        assert sess.meta_incomplete is False

    def test_refresh_keeps_flag_while_tmux_still_failing(self):
        from api.terminal_session import TerminalSession
        sess = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        sess.meta_incomplete = True
        with patch("api.terminal_session.load_tmux_metadata", return_value=None):
            sess.refresh_metadata_if_incomplete()
        assert sess.workspace is None
        assert sess.meta_incomplete is True

    def test_refresh_does_not_clobber_runtime_workspace(self):
        # 回復前に PUT /workspace 等で設定された値は tmux env で上書きしない。
        from api.terminal_session import TerminalSession
        sess = TerminalSession(workspace="manual-ws", tmux_session_name=self.TMUX_NAME)
        sess.meta_incomplete = True
        with patch("api.terminal_session.load_tmux_metadata",
                   return_value={"TMUX_WORKSPACE": "ws1"}):
            sess.refresh_metadata_if_incomplete()
        assert sess.workspace == "manual-ws"
        assert sess.meta_incomplete is False

    def test_refresh_noop_when_metadata_complete(self):
        from api.terminal_session import TerminalSession
        sess = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        with patch("api.terminal_session.load_tmux_metadata") as load:
            sess.refresh_metadata_if_incomplete()
        load.assert_not_called()

    def test_list_sessions_heals_cached_incomplete_session(self, client):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        session.meta_incomplete = True
        with sessions_lock:
            TERMINAL_SESSIONS[self.SESSION_ID] = session
        try:
            list_result = subprocess.CompletedProcess(
                args=[], returncode=0, stdout=f"{self.TMUX_NAME}\t1700000000\n", stderr="")
            with patch("api.session_snapshot._run_tmux_cmd", return_value=list_result), \
                 patch("api.terminal_session.load_tmux_metadata",
                       return_value={"TMUX_WORKSPACE": "ws1"}):
                res = client.get("/terminal/sessions", headers=AUTH)
            assert res.status_code == 200
            entry = next(s for s in res.json() if s["session_id"] == self.SESSION_ID)
            assert entry["workspace"] == "ws1"
            assert session.workspace == "ws1"
            assert session.meta_incomplete is False
        finally:
            self._pop_registry()

    def test_get_terminal_session_heals_cached_incomplete_session(self):
        from api.terminal_session import (
            TERMINAL_SESSIONS,
            TerminalSession,
            get_terminal_session,
            sessions_lock,
        )
        session = TerminalSession(workspace=None, tmux_session_name=self.TMUX_NAME)
        session.meta_incomplete = True
        with sessions_lock:
            TERMINAL_SESSIONS[self.SESSION_ID] = session
        try:
            with patch("api.terminal_session.load_tmux_metadata",
                       return_value={"TMUX_WORKSPACE": "ws1"}):
                got = get_terminal_session(self.SESSION_ID)
            assert got is session
            assert got.workspace == "ws1"
            assert got.meta_incomplete is False
        finally:
            self._pop_registry()
