"""api/routers/git_file_utils.py の純粋ヘルパー関数の単体テスト。"""

import os
from pathlib import Path
from unittest import mock


class TestResolveSymlinkTarget:
    def test_target_outside_workspace(self, tmp_path):
        from api.routers.git_file_utils import _resolve_symlink_target
        ws = tmp_path / "ws"
        ws.mkdir()
        target = ws
        item = {}
        _resolve_symlink_target(ws, target, item, "/etc/passwd")
        assert item["target_type"] == "outside"
        assert item["link_target"] == "/etc/passwd"

    def test_target_is_dir(self, tmp_path):
        from api.routers.git_file_utils import _resolve_symlink_target
        ws = tmp_path / "ws"
        ws.mkdir()
        sub = ws / "sub"
        sub.mkdir()
        item = {}
        _resolve_symlink_target(ws, ws, item, "sub")
        assert item["target_type"] == "dir"
        assert item["target_path"] == "sub"

    def test_target_is_file(self, tmp_path):
        from api.routers.git_file_utils import _resolve_symlink_target
        ws = tmp_path / "ws"
        ws.mkdir()
        f = ws / "file.txt"
        f.write_text("hello")
        item = {}
        _resolve_symlink_target(ws, ws, item, "file.txt")
        assert item["target_type"] == "file"

    def test_target_missing(self, tmp_path):
        from api.routers.git_file_utils import _resolve_symlink_target
        ws = tmp_path / "ws"
        ws.mkdir()
        item = {}
        _resolve_symlink_target(ws, ws, item, "nonexistent")
        assert item["target_type"] == "missing"


class TestBuildSymlinkEntry:
    def test_ignored_flag(self, tmp_path):
        from api.routers.git_file_utils import _build_symlink_entry
        ws = tmp_path / "ws"
        ws.mkdir()
        f = ws / "real.txt"
        f.write_text("x")
        link = ws / "link.txt"
        link.symlink_to(f)
        entry = mock.MagicMock()
        entry.name = "link.txt"
        entry.path = str(link)
        item = _build_symlink_entry(ws, ws, entry, is_ignored=True)
        assert item["gitignored"] is True
        assert item["type"] == "symlink"

    def test_oserror_on_readlink(self, tmp_path):
        from api.routers.git_file_utils import _build_symlink_entry
        ws = tmp_path / "ws"
        ws.mkdir()
        entry = mock.MagicMock()
        entry.name = "broken"
        entry.path = str(ws / "broken")
        with mock.patch("os.readlink", side_effect=OSError("permission denied")):
            item = _build_symlink_entry(ws, ws, entry, is_ignored=False)
        assert item["target_type"] == "missing"


class TestBuildFileOrDirEntry:
    def test_ignored_dir(self, tmp_path):
        from api.routers.git_file_utils import _build_file_or_dir_entry
        d = tmp_path / "mydir"
        d.mkdir()
        entry = mock.MagicMock()
        entry.name = "mydir"
        entry.is_dir.return_value = True
        entry.stat.return_value = mock.MagicMock(st_mtime=0.0)
        entry.path = str(d)
        with mock.patch("api.routers.git_file_utils._count_directory_entries", return_value=3):
            item = _build_file_or_dir_entry(entry, is_ignored=True)
        assert item["gitignored"] is True
        assert item["count"] == 3

    def test_stat_oserror(self, tmp_path):
        from api.routers.git_file_utils import _build_file_or_dir_entry
        entry = mock.MagicMock()
        entry.name = "x.txt"
        entry.is_dir.return_value = False
        entry.stat.side_effect = OSError("no access")
        item = _build_file_or_dir_entry(entry, is_ignored=False)
        assert item["name"] == "x.txt"
        assert "mtime" not in item

    def test_count_none_not_included(self, tmp_path):
        from api.routers.git_file_utils import _build_file_or_dir_entry
        entry = mock.MagicMock()
        entry.name = "emptydir"
        entry.is_dir.return_value = True
        entry.stat.return_value = mock.MagicMock(st_mtime=0.0)
        entry.path = str(tmp_path / "emptydir")
        with mock.patch("api.routers.git_file_utils._count_directory_entries", return_value=None):
            item = _build_file_or_dir_entry(entry, is_ignored=False)
        assert "count" not in item


class TestCountDirectoryEntries:
    def test_counts_non_hidden(self, tmp_path):
        from api.routers.git_file_utils import _count_directory_entries, HIDDEN_DIRS
        d = tmp_path / "scan_target"
        d.mkdir()
        (d / "a.txt").write_text("x")
        (d / "b.txt").write_text("y")
        hidden = next(iter(HIDDEN_DIRS))
        (d / hidden).mkdir()
        count = _count_directory_entries(str(d))
        assert count == 2

    def test_oserror_returns_none(self, tmp_path):
        from api.routers.git_file_utils import _count_directory_entries
        with mock.patch("os.scandir", side_effect=OSError("no access")):
            assert _count_directory_entries(str(tmp_path)) is None


class TestGetGitIgnoredNames:
    def test_exception_returns_empty_set(self, tmp_path):
        from api.routers.git_file_utils import _get_gitignored_names
        with mock.patch("api.routers.git_file_utils.run_git_command", side_effect=OSError("fail")):
            result = _get_gitignored_names(tmp_path, tmp_path)
        assert result == set()

    def test_nonzero_exit_returns_empty_set(self, tmp_path):
        from api.routers.git_file_utils import _get_gitignored_names
        bad_result = {"exit_code": 1, "stdout": ""}
        with mock.patch("api.routers.git_file_utils.run_git_command", return_value=bad_result):
            result = _get_gitignored_names(tmp_path, tmp_path)
        assert result == set()

    def test_filters_names_with_slash(self, tmp_path):
        from api.routers.git_file_utils import _get_gitignored_names
        good_result = {"exit_code": 0, "stdout": "node_modules/\nbuild/\n"}
        with mock.patch("api.routers.git_file_utils.run_git_command", return_value=good_result):
            result = _get_gitignored_names(tmp_path, tmp_path)
        assert "node_modules" in result
        assert "build" in result
