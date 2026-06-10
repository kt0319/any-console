import pytest


# --- ユーティリティ ---


class TestUtils:
    def test_validate_commit_hash_valid(self):
        from api.validators import validate_commit_hash

        assert validate_commit_hash("abcd") == "abcd"
        assert validate_commit_hash("a" * 40) == "a" * 40

    def test_validate_commit_hash_invalid(self):
        from api.validators import validate_commit_hash
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            validate_commit_hash("xyz")
        assert exc_info.value.status_code == 400

        with pytest.raises(HTTPException):
            validate_commit_hash("abc")

        with pytest.raises(HTTPException):
            validate_commit_hash("ABCD")

    def test_resolve_workspace_path_invalid(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("../etc")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_not_found(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("nonexistent")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_none(self):
        from api.common import resolve_workspace_path

        assert resolve_workspace_path(None) is None
        assert resolve_workspace_path("") is None


class TestRunCmdSafe:
    """system._run_cmd_safe のユニットテスト"""

    def test_success_returns_stdout(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: sp.CompletedProcess(cmd, 0, stdout="hello\n", stderr=""))
        assert _run_cmd_safe(["echo", "hello"]) == "hello\n"

    def test_nonzero_exit_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: sp.CompletedProcess(cmd, 1, stdout="", stderr="err"))
        assert _run_cmd_safe(["false"]) is None

    def test_timeout_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        def raise_timeout(cmd, **kwargs):
            raise sp.TimeoutExpired(cmd, 5)

        monkeypatch.setattr(sp, "run", raise_timeout)
        assert _run_cmd_safe(["sleep", "99"]) is None

    def test_file_not_found_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: (_ for _ in ()).throw(FileNotFoundError("no such file")))
        assert _run_cmd_safe(["no-such-cmd"]) is None

    def test_oserror_returns_none(self, monkeypatch):
        import subprocess as sp
        from api.routers.system import _run_cmd_safe

        monkeypatch.setattr(sp, "run", lambda cmd, **kwargs: (_ for _ in ()).throw(OSError("permission denied")))
        assert _run_cmd_safe(["restricted-cmd"]) is None
