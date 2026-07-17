from .common import (
    BRANCH_NAME_PATTERN,
    COMMIT_REF_PATTERN,
    ICON_COLOR_PATTERN,
    ICON_PATTERN,
    MAX_ICON_VALUE_LENGTH,
    STASH_REF_PATTERN,
    WORKSPACE_NAME_PATTERN,
)
from .errors import bad_request
from .icons import normalize_icon


def validate_workspace_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise bad_request("Workspace name is required")
    if not WORKSPACE_NAME_PATTERN.match(name):
        raise bad_request(f"Invalid workspace name: {name}")
    return name


def validate_branch_name(branch: str) -> str:
    branch = branch.strip()
    if not branch:
        raise bad_request("Branch is required")
    if not BRANCH_NAME_PATTERN.match(branch):
        raise bad_request(f"Invalid branch name: {branch}")
    return branch


def validate_commit_ref(commit_ref: str) -> str:
    """commit を指す ref（コミットハッシュまたは stash エントリ）を検証する。"""
    if not COMMIT_REF_PATTERN.match(commit_ref):
        raise bad_request(f"Invalid commit ref: {commit_ref}")
    return commit_ref


def validate_stash_ref(stash_ref: str) -> str:
    ref = stash_ref.strip()
    if not STASH_REF_PATTERN.match(ref):
        raise bad_request(f"Invalid stash ref: {ref}")
    return ref


def validate_optional_commit_ref(ref: str | None) -> str | None:
    """空・None は None を返し、それ以外は validate_commit_ref で検証する。"""
    value = (ref or "").strip()
    if not value:
        return None
    return validate_commit_ref(value)


def validate_icon(icon: str) -> str:
    icon = icon.strip()
    if not icon:
        return ""
    if len(icon) > MAX_ICON_VALUE_LENGTH:
        raise bad_request("Icon value too long")
    icon = normalize_icon(icon)
    if not ICON_PATTERN.match(icon):
        raise bad_request(f"Invalid icon format: {icon}")
    return icon


def validate_icon_color(color: str) -> str:
    color = color.strip()
    if not color:
        return ""
    if not ICON_COLOR_PATTERN.match(color):
        raise bad_request(f"Invalid icon color: {color}")
    return color
