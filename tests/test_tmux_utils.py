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
