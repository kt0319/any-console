import logging
import os
import subprocess

from .common import JOB_TIMEOUT_SEC, PROJECT_ROOT, sanitize_log_value
from .job_models import JobDefinition

logger = logging.getLogger(__name__)


def run_job(
    job: JobDefinition, args: list[str], workspace: str = "", extra_env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    # bash -c で実行して複数行スクリプト・パイプ・制御構文に対応する。
    # args は bash の $1..$N として渡る（"bash" は $0 用のダミー）。
    cmd_parts = ["bash", "-c", job.command, "bash", *(args or [])]
    env = {**os.environ}
    if workspace:
        env["WORKSPACE"] = workspace
    if extra_env:
        env.update(extra_env)
    cwd = workspace if workspace else str(PROJECT_ROOT)

    timeout = job.timeout_sec if job.timeout_sec is not None else JOB_TIMEOUT_SEC
    logger.info("run command=%s args=%s cwd=%s timeout=%s", sanitize_log_value(job.command), args, cwd, timeout)
    result = subprocess.run(
        cmd_parts,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=timeout,
    )
    logger.info("done command=%s rc=%d stdout_len=%d stderr_len=%d",
                sanitize_log_value(job.command), result.returncode, len(result.stdout), len(result.stderr))
    return result
