"""api/tmux.py のユーティリティ関数テスト。"""

import subprocess
from unittest import mock


class TestLoadTmuxMetadata:
    def test_returns_empty_if_run_tmux_cmd_fails(self):
        from api.tmux import load_tmux_metadata
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert load_tmux_metadata("test-session") == {}

    def test_returns_empty_if_nonzero_returncode(self):
        from api.tmux import load_tmux_metadata
        result = mock.MagicMock()
        result.returncode = 1
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert load_tmux_metadata("test-session") == {}

    def test_parses_known_env_vars(self):
        from api.tmux import load_tmux_metadata, TMUX_META_ENV_NAMES
        key = next(iter(TMUX_META_ENV_NAMES))
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = f"{key}=some_value\nUNKNOWN_KEY=ignored\nno_equals_sign\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            meta = load_tmux_metadata("test-session")
        assert meta.get(key) == "some_value"
        assert "UNKNOWN_KEY" not in meta


class TestDetectWorkspaceFromTmux:
    def test_returns_none_if_cmd_fails(self):
        from api.tmux import detect_workspace_from_tmux
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert detect_workspace_from_tmux("test-session") is None

    def test_returns_none_if_no_matching_workspace(self, tmp_path):
        from api.tmux import detect_workspace_from_tmux
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "/some/other/path\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result), \
             mock.patch("api.tmux.list_workspace_entries" if False else "api.config.list_workspace_entries",
                        return_value={}, create=True):
            assert detect_workspace_from_tmux("test-session") is None

    def test_returns_workspace_name_on_match(self, tmp_path):
        from api.tmux import detect_workspace_from_tmux
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "/home/user/myproject\n"
        entries = {"myproject": {"path": "/home/user/myproject"}}
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result), \
             mock.patch("api.config.list_workspace_entries", return_value=entries):
            ws = detect_workspace_from_tmux("test-session")
        assert ws == "myproject"


class TestGetTmuxCreated:
    def test_returns_none_if_cmd_fails(self):
        from api.tmux import get_tmux_created
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert get_tmux_created("test-session") is None

    def test_returns_int_on_success(self):
        from api.tmux import get_tmux_created
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "1700000000\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_tmux_created("test-session") == 1700000000

    def test_returns_none_on_invalid_output(self):
        from api.tmux import get_tmux_created
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "not_a_number\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_tmux_created("test-session") is None


class TestRunTmuxCmd:
    def test_timeout_returns_none(self):
        from api.tmux import _run_tmux_cmd
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("tmux", 5)):
            assert _run_tmux_cmd("has-session", "-t", "x") is None

    def test_oserror_returns_none(self):
        from api.tmux import _run_tmux_cmd
        with mock.patch("subprocess.run", side_effect=OSError("no tmux")):
            assert _run_tmux_cmd("has-session", "-t", "x") is None

    def test_success_returns_completed_process(self):
        from api.tmux import _run_tmux_cmd
        cp = subprocess.CompletedProcess(["tmux"], 0, stdout="ok\n", stderr="")
        with mock.patch("subprocess.run", return_value=cp):
            assert _run_tmux_cmd("foo") is cp


class TestTmuxSessionExists:
    def test_true_when_returncode_zero(self):
        from api.tmux import tmux_session_exists
        result = mock.MagicMock()
        result.returncode = 0
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert tmux_session_exists("x") is True

    def test_false_when_nonzero(self):
        from api.tmux import tmux_session_exists
        result = mock.MagicMock()
        result.returncode = 1
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert tmux_session_exists("x") is False

    def test_false_when_none(self):
        from api.tmux import tmux_session_exists
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert tmux_session_exists("x") is False


class TestHasTmuxSession:
    """tri-state 版。一時失敗（None）を「不在」（False）と区別する。"""

    def test_true_when_returncode_zero(self):
        from api.tmux import has_tmux_session
        result = mock.MagicMock()
        result.returncode = 0
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert has_tmux_session("x") is True

    def test_false_when_nonzero(self):
        from api.tmux import has_tmux_session
        result = mock.MagicMock()
        result.returncode = 1
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert has_tmux_session("x") is False

    def test_none_when_command_failed(self):
        from api.tmux import has_tmux_session
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert has_tmux_session("x") is None


class TestKillTmuxByName:
    def test_invokes_kill_session(self):
        from api.tmux import kill_tmux_by_name
        with mock.patch("api.tmux._run_tmux_cmd") as run:
            kill_tmux_by_name("foo")
            run.assert_called_once_with("kill-session", "-t", "foo")


class TestSendKeysToTmux:
    def test_sends_text_then_enter(self):
        from api.tmux import send_keys_to_tmux
        ok = mock.MagicMock()
        ok.returncode = 0
        with mock.patch("api.tmux._run_tmux_cmd", return_value=ok) as run:
            assert send_keys_to_tmux("sess", "claude") is True
        assert run.call_args_list[0].args == ("send-keys", "-t", "sess", "--", "claude")
        assert run.call_args_list[1].args == ("send-keys", "-t", "sess", "Enter")

    def test_skips_enter_when_disabled(self):
        from api.tmux import send_keys_to_tmux
        ok = mock.MagicMock()
        ok.returncode = 0
        with mock.patch("api.tmux._run_tmux_cmd", return_value=ok) as run:
            assert send_keys_to_tmux("sess", "hi", enter=False) is True
        assert run.call_count == 1

    def test_false_when_send_fails(self):
        from api.tmux import send_keys_to_tmux
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert send_keys_to_tmux("sess", "x") is False

    def test_false_when_enter_fails(self):
        from api.tmux import send_keys_to_tmux
        ok = mock.MagicMock()
        ok.returncode = 0
        fail = mock.MagicMock()
        fail.returncode = 1
        with mock.patch("api.tmux._run_tmux_cmd", side_effect=[ok, fail]):
            assert send_keys_to_tmux("sess", "x") is False


class TestWaitPaneReady:
    def test_true_when_pane_command_present(self):
        from api.tmux import wait_pane_ready
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "zsh\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert wait_pane_ready("sess") is True

    def test_false_on_timeout(self):
        from api.tmux import wait_pane_ready
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "\n"  # 常に空 → 準備完了とみなさない
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result), \
             mock.patch("api.tmux.time.sleep"):
            assert wait_pane_ready("sess", timeout_sec=0.01) is False


class TestRunOutsideCgroup:
    def test_fallback_to_plain_run_on_oserror(self):
        from api import tmux as tmux_mod
        fallback_cp = subprocess.CompletedProcess(["echo"], 0, stdout="", stderr="")
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd[0])
            if cmd[0] == "systemd-run":
                raise OSError("not available")
            return fallback_cp

        with mock.patch.object(tmux_mod.subprocess, "run", side_effect=fake_run):
            result = tmux_mod.run_outside_cgroup(["echo", "hi"])
        assert result is fallback_cp
        assert "systemd-run" in calls
        assert "echo" in calls


class TestGetSessionCwd:
    def test_returns_cwd_on_success(self):
        from api.tmux import get_session_cwd
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "/home/user/project\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_session_cwd("sess") == "/home/user/project"

    def test_returns_none_on_empty_output(self):
        from api.tmux import get_session_cwd
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_session_cwd("sess") is None

    def test_returns_none_on_failure(self):
        from api.tmux import get_session_cwd
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert get_session_cwd("sess") is None


class TestGetWindowWidth:
    def test_returns_width_on_success(self):
        from api.tmux import get_window_width
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "220\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_window_width("sess") == 220

    def test_returns_none_on_invalid_output(self):
        from api.tmux import get_window_width
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "not_a_number\n"
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result):
            assert get_window_width("sess") is None

    def test_returns_none_on_failure(self):
        from api.tmux import get_window_width
        with mock.patch("api.tmux._run_tmux_cmd", return_value=None):
            assert get_window_width("sess") is None


class TestDetectWorkspaceFromTmuxSubpath:
    def test_matches_subpath_of_workspace(self):
        from api.tmux import detect_workspace_from_tmux
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "/home/user/myproject/src\n"
        entries = {"myproject": {"path": "/home/user/myproject"}}
        with mock.patch("api.tmux._run_tmux_cmd", return_value=result), \
             mock.patch("api.config.list_workspace_entries", return_value=entries):
            ws = detect_workspace_from_tmux("sess")
        assert ws == "myproject"
