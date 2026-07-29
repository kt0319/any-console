"""api/routers/terminal.py のエンドポイント単体テスト。

既存の test_terminal_jobs.py がカバーしていないエラーパス・認証ガードを補完する。
"""
import subprocess
from unittest import mock
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
        # tmux コマンド自体が失敗（タイムアウト/OSError で None）した場合、
        # 「セッション0件」と誤解されないよう空配列ではなくエラーを返す
        # （クライアント側の syncSessionsFromServer がタブを全消去してしまうため）。
        with patch("api.routers.terminal._run_tmux_cmd", return_value=None):
            res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 500

    def test_tmux_no_sessions_returns_empty_list(self, client):
        # tmux が正常応答した上での「セッション無し」（非ゼロ終了）は正当な空配列。
        no_sessions = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="no server running")
        with patch("api.routers.terminal._run_tmux_cmd", return_value=no_sessions):
            res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == []

    def test_uncached_session_reports_interactive_from_tmux_env(self, client):
        # サーバー再起動直後等で TERMINAL_SESSIONS の in-memory キャッシュが無い
        # セッションは TerminalSession.from_tmux() 経由で tmux 環境変数から
        # 復元される。TMUX_INTERACTIVE が TMUX_META_ENV_NAMES に無いと常に
        # interactive=False に化けてタブバーから消える回帰を防ぐ。
        from api.common import TMUX_SESSION_PREFIX
        session_name = f"{TMUX_SESSION_PREFIX}sess-uncached"

        def fake_run(*args):
            result = mock.MagicMock()
            result.returncode = 0
            if args[0] == "list-sessions":
                result.stdout = f"{session_name}\n"
            elif args[0] == "show-environment":
                result.stdout = "TMUX_INTERACTIVE=1\nTMUX_WORKSPACE=demo\n"
            elif args[0] == "display-message":
                result.stdout = "1700000000\n"
            else:
                result.stdout = ""
            return result

        with patch("api.routers.terminal._run_tmux_cmd", side_effect=fake_run), \
             patch("api.tmux._run_tmux_cmd", side_effect=fake_run):
            res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        sessions = res.json()
        assert len(sessions) == 1
        assert sessions[0]["interactive"] is True


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
