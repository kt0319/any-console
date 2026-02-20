import os
import subprocess
from pathlib import Path

from .jobs import JobDefinition

PROJECT_ROOT = Path(__file__).resolve().parent.parent

EXEC_TIMEOUT_SEC = 120


def run_job(
    job: JobDefinition, args: list[str], workspace: str = ""
) -> subprocess.CompletedProcess:
    script = str(job.script_path)
    cmd = [script] + args
    env = {**os.environ}
    if workspace:
        env["WORKSPACE"] = workspace
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=EXEC_TIMEOUT_SEC,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
