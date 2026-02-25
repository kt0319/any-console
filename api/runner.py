import logging
import os
import shlex
import subprocess

from .common import PROJECT_ROOT
from .jobs import JobDefinition

logger = logging.getLogger(__name__)

EXEC_TIMEOUT_SEC = 120


def run_job(
    job: JobDefinition, args: list[str], workspace: str = "", extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    cmd_parts = shlex.split(job.command)
    if args:
        cmd_parts.extend(args)
    env = {**os.environ}
    if workspace:
        env["WORKSPACE"] = workspace
    if extra_env:
        env.update(extra_env)
    cwd = workspace if workspace else str(PROJECT_ROOT)

    logger.info("run command=%s args=%s cwd=%s", job.command, args, cwd)
    result = subprocess.run(
        cmd_parts,
        capture_output=True,
        text=True,
        timeout=EXEC_TIMEOUT_SEC,
        cwd=cwd,
        env=env,
    )
    logger.info("done command=%s rc=%d stdout_len=%d stderr_len=%d",
                job.command, result.returncode, len(result.stdout), len(result.stderr))
    return result
