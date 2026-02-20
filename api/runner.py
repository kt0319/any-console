import os
import subprocess
from pathlib import Path

from .jobs import JobDefinition

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
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=EXEC_TIMEOUT_SEC,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
