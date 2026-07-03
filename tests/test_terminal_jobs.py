import pytest

from conftest import AUTH


class TestJobExecution:
    def test_run_nonexistent_job(self, client, workspace):
        res = client.post("/run", headers=AUTH, json={
            "job": "nonexistent",
            "workspace": "test-ws",
        })
        assert res.status_code == 400

    def test_run_job_without_workspace(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "echo",
            "command": "echo hello",
            "terminal": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        res = client.post("/run", headers=AUTH, json={
            "job": job_name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["exit_code"] == 0
        assert "hello" in data["stdout"]


class TestTerminalSession:
    def test_create_terminal_session(self, client, workspace):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "session_id" in data
        assert data["ws_url"].startswith("/terminal/ws/")

    def test_list_sessions(self, client, workspace):
        client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })

        res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        sessions = res.json()
        assert len(sessions) >= 1

    def test_delete_session(self, client, workspace):
        create_res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        session_id = create_res.json()["session_id"]

        res = client.delete(f"/terminal/sessions/{session_id}", headers=AUTH)
        assert res.status_code == 200

    def test_delete_nonexistent_session(self, client):
        res = client.delete("/terminal/sessions/nonexistent", headers=AUTH)
        assert res.status_code == 404


class TestSessionLimit:
    def test_session_limit_exceeded(self, client, workspace, monkeypatch):
        import api.common as common_mod
        monkeypatch.setattr(common_mod, "MAX_TERMINAL_SESSIONS", 2)

        import api.routers.job_runner as job_runner_mod
        monkeypatch.setattr(job_runner_mod, "MAX_TERMINAL_SESSIONS", 2)

        for _ in range(2):
            res = client.post("/run", headers=AUTH, json={
                "job": "terminal",
                "workspace": "test-ws",
            })
            assert res.status_code == 200

        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 429


class TestTerminalSessionMetadata:
    def test_session_metadata(self, client, workspace):
        """POST /run で作成後、GET /terminal/sessions にメタデータ反映"""
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "icon": "mdi-console",
            "icon_color": "#ff0000",
            "job_name": "my_job",
            "job_label": "My Job",
        })
        assert res.status_code == 200
        session_id = res.json()["session_id"]

        sessions_res = client.get("/terminal/sessions", headers=AUTH)
        assert sessions_res.status_code == 200
        sessions = sessions_res.json()
        matched = [s for s in sessions if s["session_id"] == session_id]
        assert len(matched) == 1
        assert matched[0]["workspace"] == "test-ws"
        assert matched[0]["icon"] == "mdi-console"
        assert matched[0]["icon_color"] == "#ff0000"
        assert matched[0]["job_name"] == "my_job"
        assert matched[0]["job_label"] == "My Job"


class TestTerminalCommandInjection:
    """terminal ジョブの command をサーバ側 send-keys で投入する挙動。"""

    @pytest.fixture()
    def captured_keys(self, monkeypatch):
        """send-keys 呼び出しを捕捉し、実 tmux への注入とペイン待ちを抑止する。"""
        calls = []

        def fake_send(session_name, text, *, enter=True):
            calls.append({"session": session_name, "text": text, "enter": enter})
            return True

        monkeypatch.setattr("api.routers.job_runner.send_keys_to_tmux", fake_send)
        monkeypatch.setattr("api.routers.job_runner.wait_pane_ready", lambda *a, **k: True)
        return calls

    def test_no_command_does_not_inject(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        assert captured_keys == []

    def test_command_is_sent_server_side(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "claude",
        })
        assert res.status_code == 200
        assert len(captured_keys) == 1
        assert captured_keys[0]["text"] == "claude"

    def test_multiline_command_is_preserved(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "echo a\necho b",
        })
        assert res.status_code == 200
        # 複数行スクリプトはそのまま送る（改行は弾かない）
        assert captured_keys[0]["text"] == "echo a\necho b"

    def test_blank_command_is_ignored(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "   ",
        })
        assert res.status_code == 200
        assert captured_keys == []

    def test_rejects_nul_byte(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "claude\x00rm -rf /",
        })
        assert res.status_code == 400
        assert captured_keys == []

    def test_rejects_too_long_command(self, client, workspace, captured_keys):
        from api.common import MAX_COMMAND_LENGTH
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "x" * (MAX_COMMAND_LENGTH + 1),
        })
        assert res.status_code == 400
        assert captured_keys == []

    def test_placeholder_is_substituted_and_quoted(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "claude [[prompt]]",
            "command_vars": {"prompt": "fix the bug; rm -rf /"},
        })
        assert res.status_code == 200
        # 値は shlex.quote され、シェルに解釈されない単一引数になる
        assert captured_keys[0]["text"] == "claude 'fix the bug; rm -rf /'"

    def test_multiple_placeholders(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "run [[a]] --to [[b]]",
            "command_vars": {"a": "x y", "b": "z"},
        })
        assert res.status_code == 200
        assert captured_keys[0]["text"] == "run 'x y' --to z"

    def test_unfilled_placeholder_is_left_as_is(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "echo [[missing]]",
            "command_vars": {},
        })
        assert res.status_code == 200
        assert captured_keys[0]["text"] == "echo [[missing]]"

    def test_substituted_command_length_is_enforced(self, client, workspace, captured_keys):
        from api.common import MAX_COMMAND_LENGTH
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "claude [[prompt]]",
            "command_vars": {"prompt": "x" * (MAX_COMMAND_LENGTH + 1)},
        })
        assert res.status_code == 400
        assert captured_keys == []

    def test_comment_lines_are_stripped(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "# this is a comment\nclaude hello",
            "command_vars": {},
        })
        assert res.status_code == 200
        assert captured_keys[0]["text"] == "claude hello"

    def test_indented_comment_lines_are_stripped(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "  # indented comment\nclaude hello",
            "command_vars": {},
        })
        assert res.status_code == 200
        assert captured_keys[0]["text"] == "claude hello"

    def test_only_comment_lines_results_in_no_command(self, client, workspace, captured_keys):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "command": "# only a comment",
            "command_vars": {},
        })
        assert res.status_code == 200
        assert captured_keys == []


class TestSessionState:
    def test_delete_detaches_bridges(self, client, workspace, monkeypatch):
        """セッション削除で全クライアントブリッジが detach される"""
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock

        detached = []
        monkeypatch.setattr("api.terminal_session._detach_pty_bridge",
                            lambda s: detached.append(s.tmux_session_name))
        # _kill_tmux_session calls _detach_pty_bridge + subprocess, mock subprocess part
        import subprocess as sp
        original_run = sp.run
        def mock_run(cmd, **kwargs):
            if "kill-session" in cmd:
                return sp.CompletedProcess(cmd, 0)
            return original_run(cmd, **kwargs)
        monkeypatch.setattr(sp, "run", mock_run)

        session = TerminalSession(
            workspace="test-ws",
            tmux_session_name="ac-test-pty-bridge",
        )
        with sessions_lock:
            TERMINAL_SESSIONS["pty-test"] = session

        res = client.delete("/terminal/sessions/pty-test", headers=AUTH)
        assert res.status_code == 200
        assert "ac-test-pty-bridge" in detached


class TestApplyBridgeSize:
    """_apply_bridge_size はサイズが実際に変化した時だけ resize_client_pty を呼ぶ。"""

    def _make_bridge(self):
        from api.terminal_session import ClientBridge
        return ClientBridge(fd=999, pid=1)

    def test_applies_only_on_change(self, monkeypatch):
        from api import terminal_session as ts

        calls = []
        monkeypatch.setattr(ts, "resize_client_pty", lambda *a: calls.append(a))
        bridge = self._make_bridge()
        bridge.applied_size = None

        ts._apply_bridge_size(bridge, 120, 40)
        ts._apply_bridge_size(bridge, 120, 40)  # 同一サイズは無視される
        assert calls == [(999, 120, 40)]
        assert bridge.applied_size == (120, 40)

        ts._apply_bridge_size(bridge, 80, 24)  # 変化したので反映
        assert calls[-1] == (999, 80, 24)
        assert len(calls) == 2

    def test_ignores_non_positive_size(self, monkeypatch):
        from api import terminal_session as ts

        calls = []
        monkeypatch.setattr(ts, "resize_client_pty", lambda *a: calls.append(a))
        bridge = self._make_bridge()
        bridge.applied_size = None

        ts._apply_bridge_size(bridge, 0, 24)
        ts._apply_bridge_size(bridge, 80, 0)
        assert calls == []
        assert bridge.applied_size is None
