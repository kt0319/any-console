import subprocess
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import verify_token
from .jobs import JOBS
from .runner import run_job

app = FastAPI(title="pi-console")

UI_DIR = Path(__file__).resolve().parent.parent / "ui"
WORK_DIR = Path.home() / "work"


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None


@app.get("/workspaces", dependencies=[Depends(verify_token)])
def list_workspaces():
    if not WORK_DIR.is_dir():
        return []
    return sorted(
        d.name for d in WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")
    )


@app.post("/run", dependencies=[Depends(verify_token)])
def execute_job(body: RunRequest):
    job_def = JOBS.get(body.job)
    if not job_def:
        raise HTTPException(status_code=400, detail=f"Unknown job: {body.job}")

    if body.workspace:
        workspace_path = WORK_DIR / body.workspace
        if not workspace_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Workspace not found: {body.workspace}")
        workspaces = [d.name for d in WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
        if body.workspace not in workspaces:
            raise HTTPException(status_code=400, detail=f"Invalid workspace: {body.workspace}")

    ordered_args: list[str] = []
    for arg_option in job_def.args:
        value = body.args.get(arg_option.name)
        if value is None:
            if arg_option.required:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required argument: {arg_option.name}",
                )
            continue
        if value not in arg_option.values:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid value for {arg_option.name}: {value} (allowed: {arg_option.values})",
            )
        ordered_args.append(value)

    workspace_path = str(WORK_DIR / body.workspace) if body.workspace else ""

    try:
        result = run_job(job_def, ordered_args, workspace=workspace_path)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Job timed out")

    return {
        "status": "ok" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


app.mount("/", StaticFiles(directory=str(UI_DIR), html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888)
