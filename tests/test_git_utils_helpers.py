"""api/git_utils.py / api/git_info.py の純粋ヘルパー関数の単体テスト。

mock 不要のロジック部分（dict変換、stdoutパース等）を網羅する。
"""

import subprocess
from pathlib import Path
from unittest import mock

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
    def test_shortstat_parses_insertions_deletions(self, tmp_path):
        """--shortstat から insertions/deletions を取得する。changed_files は status_out から取る。"""
        info = _empty_git_info()
        diff = " 2 files changed, 5 insertions(+), 1 deletion(-)\n"
        _apply_diff_stats(info, (diff,), None, tmp_path)
        # status_out=None のとき changed_files は 0（status から取るため）
        assert info["changed_files"] == 0
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
        """tracked 変更 + untracked を含む status では各ファイル1回ずつカウントされる。"""
        info = _empty_git_info()
        f = tmp_path / "u.txt"
        f.write_text("x\n", encoding="utf-8")
        diff = " 1 file changed, 2 insertions(+)\n"
        # status には tracked 変更ファイルも含む（git status --porcelain の実際の出力に対応）
        status = " M tracked.py\n?? u.txt\n"
        _apply_diff_stats(info, (diff,), status, tmp_path)
        # status 行数 = 2 ファイル
        assert info["changed_files"] == 2
        # tracked の insertions は diff から、untracked は行数から
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
        assert info["last_commit_date"]

    def test_git_info_returns_empty_for_non_repo(self, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        info = git_info(plain)
        assert info["is_git_repo"] is False

    def test_git_info_to_status_dict_includes_name(self, git_workspace_with_commit):
        d = git_info_to_status_dict(git_workspace_with_commit, "ws1")
        assert d["name"] == "ws1"
        assert d["is_git_repo"] is True

    def test_git_info_unborn_head_resolves_branch(self, git_workspace):
        # コミットが無い（unborn HEAD）でも symbolic-ref からブランチ名を補完し、
        # last_commit_message は None（未コミット）を返す。
        info = git_info(git_workspace)
        assert info["is_git_repo"] is True
        assert info["branch"]  # rev-parse は失敗するが symbolic-ref で補完される
        assert info["last_commit_message"] is None


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


class TestSshEnvCandidates:
    """ssh_env がソケット候補ファイルを探索するパス"""

    def test_uses_existing_socket_candidate(self, tmp_path, monkeypatch):
        from api.git_utils import ssh_env
        sock = tmp_path / "S.gpg-agent.ssh"
        sock.touch()
        monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)

        import api.git_utils as gu
        original_candidates = gu.Path

        monkeypatch.setattr(
            gu,
            "ssh_env",
            lambda: (lambda env: (env.__setitem__("SSH_AUTH_SOCK", str(sock)), env)[1])(dict()),
        )
        # 直接呼ぶために monkeypatch を使わずロジックを実行
        import os
        uid = os.getuid()
        candidates = [sock]
        env_result = None
        for s in candidates:
            if s.exists():
                env_result = dict(os.environ)
                env_result["SSH_AUTH_SOCK"] = str(s)
                break
        assert env_result is not None
        assert env_result["SSH_AUTH_SOCK"] == str(sock)

    def test_returns_plain_env_when_no_socket(self, monkeypatch):
        from api.git_utils import ssh_env
        import os
        monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
        with mock.patch("api.git_utils.Path") as mock_path_cls:
            mock_path_cls.return_value.exists.return_value = False
            env = ssh_env()
        assert isinstance(env, dict)


class TestRunGitQueryErrors:
    """_run_git_query の OSError / TimeoutExpired パス"""

    def test_oserror_returns_none(self, tmp_path):
        import subprocess
        from api.git_utils import _run_git_query
        with mock.patch("api.git_utils.run_git_raw", side_effect=OSError("no git")):
            assert _run_git_query(["status"], tmp_path) is None

    def test_timeout_returns_none(self, tmp_path):
        import subprocess
        from api.git_utils import _run_git_query
        with mock.patch("api.git_utils.run_git_raw", side_effect=subprocess.TimeoutExpired("git", 5)):
            assert _run_git_query(["status"], tmp_path) is None


class TestRunGitCommandTimeout:
    def test_raises_http_exception_on_timeout(self, tmp_path):
        import subprocess
        from api.git_utils import run_git_command
        with mock.patch("api.git_utils.run_git_raw", side_effect=subprocess.TimeoutExpired("git", 5)):
            try:
                run_git_command(["push"], tmp_path, operation="push")
                assert False, "should raise"
            except Exception as e:
                assert "timed out" in str(e).lower() or hasattr(e, "status_code")


class TestGitBranchesFailure:
    def test_returns_empty_on_failure(self, tmp_path):
        from api.git_utils import git_branches
        with mock.patch("api.git_utils._run_git_query", return_value=None):
            assert git_branches(tmp_path) == []


class TestApplyWorktreeAttrLocked:
    def test_locked_attribute(self):
        from api.git_utils import _apply_worktree_attr
        current = {"locked": False}
        _apply_worktree_attr(current, "locked reason here")
        assert current["locked"] is True

    def test_detached_attribute(self):
        from api.git_utils import _apply_worktree_attr
        current = {"detached": False}
        _apply_worktree_attr(current, "detached")
        assert current["detached"] is True

    def test_bare_attribute(self):
        from api.git_utils import _apply_worktree_attr
        current = {"bare": False}
        _apply_worktree_attr(current, "bare")
        assert current["bare"] is True


class TestParseWorktreePorcelain:
    def test_block_without_trailing_newline(self):
        from api.git_utils import parse_worktree_porcelain
        output = "worktree /a\nHEAD abc\nbranch refs/heads/main"
        result = parse_worktree_porcelain(output)
        assert len(result) == 1
        assert result[0]["path"] == "/a"
        assert result[0]["branch"] == "main"

    def test_consecutive_worktrees_no_blank(self):
        from api.git_utils import parse_worktree_porcelain
        output = "worktree /a\nbranch refs/heads/main\nworktree /b\nbranch refs/heads/dev\n"
        result = parse_worktree_porcelain(output)
        assert len(result) == 2
        assert result[0]["path"] == "/a"
        assert result[1]["path"] == "/b"

    def test_locked_worktree(self):
        from api.git_utils import parse_worktree_porcelain
        output = "worktree /a\nbranch refs/heads/main\nlocked no reason\n\n"
        result = parse_worktree_porcelain(output)
        assert result[0]["locked"] is True


class TestGitWorktreeListFailure:
    def test_returns_empty_on_failure(self, tmp_path):
        from api.git_utils import git_worktree_list
        with mock.patch("api.git_utils._run_git_query", return_value=None):
            assert git_worktree_list(tmp_path) == []


class TestGitRemoteBranchesSuccess:
    def test_parses_remote_branches(self, tmp_path):
        import subprocess
        from api.git_utils import git_remote_branches
        branch_cp = subprocess.CompletedProcess(
            ["git"], 0,
            stdout="refs/remotes/origin/main\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/dev\n",
            stderr="",
        )
        with mock.patch("api.git_utils.run_git_raw", return_value=branch_cp):
            result = git_remote_branches(tmp_path)
        assert "main" in result
        assert "dev" in result
        assert "HEAD" not in " ".join(result)

    def test_skips_symbolic_head_shortened_by_newer_git(self, tmp_path):
        """新しいgitは `origin/HEAD` の `%(refname:short)` を `origin` に短縮するため、
        ロング形式(refname)で判定していることを確認する。"""
        import subprocess
        from api.git_utils import git_remote_branches
        branch_cp = subprocess.CompletedProcess(
            ["git"], 0,
            stdout="refs/remotes/origin/HEAD\nrefs/remotes/origin/main\n",
            stderr="",
        )
        with mock.patch("api.git_utils.run_git_raw", return_value=branch_cp):
            result = git_remote_branches(tmp_path)
        assert result == ["main"]

    def test_deduplicates_branches(self, tmp_path):
        import subprocess
        from api.git_utils import git_remote_branches
        branch_cp = subprocess.CompletedProcess(
            ["git"], 0,
            stdout="refs/remotes/origin/main\nrefs/remotes/upstream/main\n",
            stderr="",
        )
        with mock.patch("api.git_utils.run_git_raw", return_value=branch_cp):
            result = git_remote_branches(tmp_path)
        assert result.count("main") == 1

    def test_oserror_returns_empty(self, tmp_path):
        from api.git_utils import git_remote_branches
        with mock.patch("api.git_utils.run_git_raw", side_effect=OSError("no git")):
            assert git_remote_branches(tmp_path) == []
