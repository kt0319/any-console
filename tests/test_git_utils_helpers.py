"""api/git_utils.py の純粋ヘルパー関数の単体テスト。

mock 不要のロジック部分（dict変換、stdoutパース等）を網羅する。
"""

import subprocess
from pathlib import Path

from api.git_info import (
    _apply_ahead_behind,
    _apply_branch_and_remote,
    _apply_diff_stats,
    _apply_upstream,
    _empty_git_info,
    _parse_revlist_pair,
    git_info,
    git_info_to_status_dict,
    invalidate_git_info,
)
from api.git_utils import (
    command_result_dict,
    git_branch,
    git_branches,
    git_is_repo,
    git_remote_branches,
    ssh_env,
)


class TestCommandResultDict:
    def test_success(self):
        cp = subprocess.CompletedProcess(["git"], 0, stdout="out", stderr="err")
        d = command_result_dict(cp)
        assert d == {"status": "ok", "exit_code": 0, "stdout": "out", "stderr": "err", "detail": "err"}

    def test_failure(self):
        cp = subprocess.CompletedProcess(["git"], 1, stdout="", stderr="fatal")
        d = command_result_dict(cp)
        assert d["status"] == "error"
        assert d["exit_code"] == 1
        assert d["detail"] == "fatal"


class TestParseRevlistPair:
    def test_valid_pair(self):
        assert _parse_revlist_pair("3\t5\n") == (3, 5)

    def test_invalid_count(self):
        assert _parse_revlist_pair("3\n") is None

    def test_non_numeric(self):
        assert _parse_revlist_pair("a\tb") is None


class TestApplyBranchAndRemote:
    def test_branch_set_and_remote_present(self):
        info = _empty_git_info()
        _apply_branch_and_remote(info, "main\n", "origin/main\norigin/dev\n")
        assert info["branch"] == "main"
        assert info["has_remote_branch"] is True

    def test_branch_set_but_no_remote(self):
        info = _empty_git_info()
        _apply_branch_and_remote(info, "feature\n", "origin/main\n")
        assert info["branch"] == "feature"
        assert info["has_remote_branch"] is False

    def test_no_branch(self):
        info = _empty_git_info()
        _apply_branch_and_remote(info, None, None)
        assert info["branch"] is None
        # branch がなければ has_remote_branch も触らない
        assert info["has_remote_branch"] is None


class TestApplyUpstream:
    def test_with_upstream(self):
        info = _empty_git_info()
        _apply_upstream(info, "origin/main\n")
        assert info["upstream"] == "origin/main"
        assert info["has_upstream"] is True

    def test_no_upstream(self):
        info = _empty_git_info()
        _apply_upstream(info, None)
        assert info["has_upstream"] is False
        assert info["upstream"] is None

    def test_empty_upstream(self):
        info = _empty_git_info()
        _apply_upstream(info, "   \n")
        assert info["has_upstream"] is False


class TestApplyDiffStats:
    def test_shortstat_parsing(self, tmp_path):
        info = _empty_git_info()
        diff = " 2 files changed, 5 insertions(+), 1 deletion(-)\n"
        _apply_diff_stats(info, (diff,), None, tmp_path)
        assert info["changed_files"] == 2
        assert info["insertions"] == 5
        assert info["deletions"] == 1

    def test_untracked_file_counts_as_change(self, tmp_path):
        info = _empty_git_info()
        f = tmp_path / "new.txt"
        f.write_text("a\nb\nc\n", encoding="utf-8")
        status = "?? new.txt\n"
        _apply_diff_stats(info, ("",), status, tmp_path)
        assert info["changed_files"] == 1
        # 3 行の untracked が insertions に加算
        assert info["insertions"] == 3

    def test_combined_diff_and_untracked(self, tmp_path):
        info = _empty_git_info()
        f = tmp_path / "u.txt"
        f.write_text("x\n", encoding="utf-8")
        diff = " 1 file changed, 2 insertions(+)\n"
        status = "?? u.txt\n"
        _apply_diff_stats(info, (diff,), status, tmp_path)
        assert info["changed_files"] == 2
        assert info["insertions"] == 3


class TestApplyAheadBehind:
    def test_revlist_with_upstream(self):
        info = _empty_git_info()
        info["has_upstream"] = True
        _apply_ahead_behind(info, "2\t3\n", lambda *args: None)
        assert info["ahead"] == 2
        assert info["behind"] == 3

    def test_unpublished_when_no_remote_branch(self):
        info = _empty_git_info()
        info["branch"] = "feature"
        info["has_remote_branch"] = False
        info["has_upstream"] = False

        def fake_run_git(*args):
            return subprocess.CompletedProcess(list(args), 0, stdout="4\n", stderr="")
        _apply_ahead_behind(info, None, fake_run_git)
        assert info["ahead"] == 4


class TestSshEnv:
    def test_returns_env_dict(self):
        env = ssh_env()
        assert isinstance(env, dict)


class TestGitRepoQueries:
    """実際の git workspace を使ったクエリ系"""

    def test_git_is_repo_true(self, git_workspace_with_commit):
        assert git_is_repo(git_workspace_with_commit) is True

    def test_git_is_repo_false_for_plain_dir(self, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        assert git_is_repo(plain) is False

    def test_git_branch_returns_current(self, git_workspace_with_commit):
        branch = git_branch(git_workspace_with_commit)
        assert isinstance(branch, str)
        assert branch  # 何かしらのブランチ名

    def test_git_branches_lists_local(self, git_workspace_with_commit):
        branches = git_branches(git_workspace_with_commit)
        assert isinstance(branches, list)
        assert len(branches) >= 1

    def test_git_remote_branches_empty_without_remote(self, git_workspace_with_commit):
        # remote 未設定だと空リスト
        result = git_remote_branches(git_workspace_with_commit)
        assert result == []

    def test_git_info_populates_basic_fields(self, git_workspace_with_commit):
        info = git_info(git_workspace_with_commit)
        assert info["is_git_repo"] is True
        assert info["branch"]
        assert info["last_commit"]

    def test_git_info_returns_empty_for_non_repo(self, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        info = git_info(plain)
        assert info["is_git_repo"] is False

    def test_git_info_to_status_dict_includes_name(self, git_workspace_with_commit):
        d = git_info_to_status_dict(git_workspace_with_commit, "ws1")
        assert d["name"] == "ws1"
        assert d["is_git_repo"] is True


class TestInvalidateGitInfo:
    def test_invalidate_existing_workspace(self, workspace):
        # 登録済みワークスペースを invalidate しても例外にならない
        invalidate_git_info("test-ws")


class TestParseGithubUrlExtras:
    """追加のURLバリエーション"""

    def test_subgroup_url(self):
        from api.git_utils import _parse_github_url
        assert _parse_github_url("git@github.com:org/repo-name.git") == "https://github.com/org/repo-name"

    def test_path_only_no_protocol(self):
        from api.git_utils import _parse_github_url
        # github.com を含まない URL
        assert _parse_github_url("git@example.com:org/repo.git") is None
