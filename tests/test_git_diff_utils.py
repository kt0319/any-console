from api.routers.git_diff_utils import (
    _resolve_rename_path,
    build_file_entry,
    build_file_list,
    parse_numstat,
    parse_numstat_result,
)


class TestResolveRenamePath:
    def test_no_rename(self):
        assert _resolve_rename_path("src/main.py") == "src/main.py"

    def test_simple_rename(self):
        assert _resolve_rename_path("src/{old.py => new.py}") == "src/new.py"

    def test_dir_rename(self):
        assert _resolve_rename_path("{old_dir => new_dir}/file.py") == "new_dir/file.py"

    def test_nested_rename(self):
        assert _resolve_rename_path("a/{b => c}/d.py") == "a/c/d.py"

    def test_empty_old_name(self):
        assert _resolve_rename_path("{ => new}/file.py") == "new/file.py"

    def test_empty_new_name(self):
        assert _resolve_rename_path("{old => }/file.py") == "/file.py"


class TestParseNumstat:
    def test_normal_output(self):
        stdout = "10\t5\tsrc/main.py\n3\t0\tREADME.md\n"
        result = parse_numstat(stdout)
        assert result["src/main.py"] == {"insertions": 10, "deletions": 5}
        assert result["README.md"] == {"insertions": 3, "deletions": 0}

    def test_binary_file(self):
        stdout = "-\t-\timage.png\n"
        result = parse_numstat(stdout)
        assert result["image.png"] == {"insertions": None, "deletions": None}

    def test_empty_output(self):
        assert parse_numstat("") == {}
        assert parse_numstat("\n\n") == {}

    def test_malformed_line_skipped(self):
        stdout = "not_a_valid_line\n10\t5\tvalid.py\n"
        result = parse_numstat(stdout)
        assert "valid.py" in result
        assert len(result) == 1

    def test_rename_path_added(self):
        stdout = "5\t2\tsrc/{old.py => new.py}\n"
        result = parse_numstat(stdout)
        assert "src/{old.py => new.py}" in result
        assert "src/new.py" in result
        assert result["src/{old.py => new.py}"] is result["src/new.py"]


class TestParseNumstatResult:
    def test_success(self):
        result = parse_numstat_result({"exit_code": 0, "stdout": "3\t1\tfile.py\n"})
        assert result["file.py"] == {"insertions": 3, "deletions": 1}

    def test_nonzero_exit(self):
        assert parse_numstat_result({"exit_code": 1, "stdout": "3\t1\tfile.py\n"}) == {}

    def test_non_string_stdout(self):
        assert parse_numstat_result({"exit_code": 0, "stdout": None}) == {}

    def test_missing_stdout(self):
        assert parse_numstat_result({"exit_code": 0}) == {}


class TestBuildFileEntry:
    def test_with_numstat(self):
        numstat = {"file.py": {"insertions": 5, "deletions": 2}}
        entry = build_file_entry("file.py", numstat)
        assert entry["name"] == "file.py"
        assert entry["insertions"] == 5
        assert entry["deletions"] == 2
        assert "status" not in entry

    def test_without_numstat(self):
        entry = build_file_entry("unknown.py", {})
        assert entry["name"] == "unknown.py"
        assert entry["insertions"] is None
        assert entry["deletions"] is None

    def test_with_status(self):
        entry = build_file_entry("file.py", {}, status="M")
        assert entry["status"] == "M"


class TestBuildFileList:
    def test_success(self):
        files_result = {"exit_code": 0, "stdout": "a.py\nb.py\n"}
        numstat = {"a.py": {"insertions": 1, "deletions": 0}}
        result = build_file_list(files_result, numstat)
        assert len(result) == 2
        assert result[0]["name"] == "a.py"
        assert result[0]["insertions"] == 1
        assert result[1]["name"] == "b.py"
        assert result[1]["insertions"] is None

    def test_nonzero_exit(self):
        assert build_file_list({"exit_code": 1, "stdout": "a.py\n"}, {}) == []

    def test_empty_lines_skipped(self):
        files_result = {"exit_code": 0, "stdout": "a.py\n\n\nb.py\n"}
        result = build_file_list(files_result, {})
        assert len(result) == 2
