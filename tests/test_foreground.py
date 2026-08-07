"""前面ジョブ取得（api/foreground.py）のテスト。

/proc・ps への実 I/O は行わず、パース純関数と分岐ロジックを検証する。
"""

from unittest import mock

from api.foreground import (
    ForegroundInspector,
    parse_ps_lines,
    parse_stat_pgrp_tpgid,
)


class TestParseStat:
    def test_normal_fields(self):
        # pid (comm) state ppid pgrp session tty_nr tpgid ...
        text = "123 (zsh) S 1 123 123 34816 4567 4194304"
        assert parse_stat_pgrp_tpgid(text) == (123, 4567)

    def test_comm_with_spaces_and_parens(self):
        text = "9 (tmux: server) (x) S 1 9 9 0 42 0"
        assert parse_stat_pgrp_tpgid(text) == (9, 42)

    def test_malformed_returns_none(self):
        assert parse_stat_pgrp_tpgid("garbage") is None
        assert parse_stat_pgrp_tpgid("1 (a) S 2") is None
        assert parse_stat_pgrp_tpgid("1 (a) S x y z w v") is None


class TestParsePsLines:
    def test_rows_with_argv(self):
        text = (
            "  100  100  200  -zsh\n"
            "  200  200  200  npm run dev\n"
            "  bad  row  here  x\n"
            "  300\n"
        )
        assert parse_ps_lines(text) == [
            (100, 100, 200, ["-zsh"]),
            (200, 200, 200, ["npm", "run", "dev"]),
        ]


class TestInspectorDarwinPath:
    """（/proc が無い環境向け）ps 表からの前面グループ抽出。"""

    def _inspector_with(self, rows_text):
        inspector = ForegroundInspector()
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = rows_text
        with mock.patch("api.foreground.run_subprocess_safe", return_value=result), \
             mock.patch("api.foreground.os.path.isdir", return_value=False):
            argvs = {pid: inspector.argvs(pid) for pid in (100,)}
        return argvs, inspector

    def test_foreground_group_argvs(self):
        argvs, _ = self._inspector_with(
            "100 100 200 -zsh\n"
            "200 200 200 npm run dev\n"
            "201 200 200 node vite\n"
            "900 900 900 unrelated\n"
        )
        assert argvs[100] == [["npm", "run", "dev"], ["node", "vite"]]

    def test_no_foreground_job_when_shell_is_foreground(self):
        argvs, _ = self._inspector_with("100 100 100 -zsh\n")
        assert argvs[100] == []

    def test_ps_failure_returns_empty(self):
        inspector = ForegroundInspector()
        with mock.patch("api.foreground.run_subprocess_safe", return_value=None), \
             mock.patch("api.foreground.os.path.isdir", return_value=False):
            assert inspector.argvs(100) == []

    def test_ps_runs_once_per_inspector(self):
        inspector = ForegroundInspector()
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = "100 100 100 -zsh\n"
        with mock.patch("api.foreground.run_subprocess_safe", return_value=result) as run, \
             mock.patch("api.foreground.os.path.isdir", return_value=False):
            inspector.argvs(100)
            inspector.argvs(100)
        assert run.call_count == 1

    def test_invalid_pid(self):
        assert ForegroundInspector().argvs(0) == []
        assert ForegroundInspector().argvs(-1) == []
