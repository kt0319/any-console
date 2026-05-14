import json
import logging

from .common import (
    GITHUB_CLI_TIMEOUT_SEC,
    TTLCache,
    run_subprocess_safe,
)

logger = logging.getLogger(__name__)

_PER_WORKSPACE_TTL_SEC = 5 * 60

_workspace_cache = TTLCache(_PER_WORKSPACE_TTL_SEC)


def run_gh(args: list[str], cwd: str | None = None):
    """Run a `gh` CLI command and return CompletedProcess (or None on failure)."""
    return run_subprocess_safe(
        ["gh", *args],
        timeout=GITHUB_CLI_TIMEOUT_SEC, cwd=cwd, log_label="gh",
    )


def run_gh_json(args: list[str], cwd: str | None = None):
    """Run gh with `--json` and parse output. Returns None on any failure."""
    result = run_gh(args, cwd=cwd)
    if result is None:
        return None
    if result.returncode != 0:
        logger.warning("gh command failed: %s stderr=%s", args, result.stderr.strip())
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        logger.warning("gh JSON parse error: %s %s", args, e)
        return None


def run_gh_json_cached(cache_key: str, args: list[str], cwd: str | None = None):
    cached = _workspace_cache.get(cache_key)
    if cached is not None:
        return cached
    data = run_gh_json(args, cwd=cwd)
    if data is None:
        return None
    _workspace_cache.set(cache_key, data)
    return data
