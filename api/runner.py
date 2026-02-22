import logging
import os
import subprocess
from pathlib import Path

from .jobs import JobDefinition

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent

EXEC_TIMEOUT_SEC = 120


def run_job(
    job: JobDefinition, args: list[str], workspace: str = "", extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    script = str(job.script_path)
    cmd = [script] + args
    if not os.access(script, os.X_OK):
        cmd = ["bash", script] + args
    env = {**os.environ}
    if workspace:
        env["WORKSPACE"] = workspace
    if extra_env:
        env.update(extra_env)
    cwd = workspace if workspace else str(PROJECT_ROOT)

    logger.info("run script=%s args=%s cwd=%s", script, args, cwd)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=EXEC_TIMEOUT_SEC,
        cwd=cwd,
        env=env,
    )
    logger.info("done script=%s rc=%d stdout_len=%d stderr_len=%d",
                script, result.returncode, len(result.stdout), len(result.stderr))
    return result
