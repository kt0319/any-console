from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routers.git_helpers import (
    get_current_branch,
    resolve_and_validate_workspace_path,
    resolve_workspace_target_path,
    validate_workspace_relative_target,
)


class TestResolveWorkspaceTargetPath:
    def test_normal_path(self, tmp_path):
        target = resolve_workspace_target_path(tmp_path, "src/main.py")
        assert target == (tmp_path / "src" / "main.py").resolve()

    def test_traversal_rejected(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_target_path(tmp_path, "../../etc/passwd")
        assert exc_info.value.status_code == 400

    def test_dot_path(self, tmp_path):
        target = resolve_workspace_target_path(tmp_path, ".")
        assert target == tmp_path.resolve()

    def test_nested_traversal_rejected(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_target_path(tmp_path, "src/../../outside")
        assert exc_info.value.status_code == 400


class TestValidateWorkspaceRelativeTarget:
    def test_normal_path(self, tmp_path):
        target = (tmp_path / "src" / "main.py").resolve()
        (tmp_path / "src").mkdir()
        rel = validate_workspace_relative_target(tmp_path, target)
        assert str(rel) == "src/main.py"

    def test_hidden_dir_rejected(self, tmp_path):
        target = (tmp_path / ".git" / "config").resolve()
        with pytest.raises(HTTPException) as exc_info:
            validate_workspace_relative_target(tmp_path, target)
        assert exc_info.value.status_code == 400

    def test_nested_hidden_dir_rejected(self, tmp_path):
        target = (tmp_path / "sub" / ".git" / "HEAD").resolve()
        with pytest.raises(HTTPException) as exc_info:
            validate_workspace_relative_target(tmp_path, target)
        assert exc_info.value.status_code == 400


class TestResolveAndValidateWorkspacePath:
    def test_valid_path(self, tmp_path):
        target, rel = resolve_and_validate_workspace_path(tmp_path, "src/file.py")
        assert target == (tmp_path / "src" / "file.py").resolve()
        assert str(rel) == "src/file.py"

    def test_traversal_rejected(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            resolve_and_validate_workspace_path(tmp_path, "../outside")
        assert exc_info.value.status_code == 400

    def test_hidden_dir_rejected(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            resolve_and_validate_workspace_path(tmp_path, ".git/config")
        assert exc_info.value.status_code == 400


class TestGetCurrentBranch:
    def test_no_branch_raises(self, monkeypatch):
        monkeypatch.setattr("api.routers.git_helpers.git_branch", lambda _: None)
        with pytest.raises(HTTPException) as exc_info:
            get_current_branch(Path("/tmp"))
        assert exc_info.value.status_code == 400

    def test_returns_branch(self, monkeypatch):
        monkeypatch.setattr("api.routers.git_helpers.git_branch", lambda _: "main")
        assert get_current_branch(Path("/tmp")) == "main"
