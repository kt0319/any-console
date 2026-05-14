"""ワークスペースジョブ / グローバルジョブの CRUD エンドポイント。

ジョブ実行（/run）は `job_runner.py`、共通ロジックは `jobs_common.py` を参照。
"""

import logging

from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, resolve_workspace_path
from ..config import load_all_config
from ..errors import not_found
from .jobs_common import (
    JobRequest,
    ReorderJobsRequest,
    _global_jobs_cache,
    _workspace_jobs_cache,
    delete_job,
    entry_to_job_definition,
    get_workspace_jobs,
    global_jobs_context,
    job_definition_to_dict,
    load_global_jobs_data,
    parse_jobs_data,
    reorder_jobs,
    save_job,
    serialize_workspace_jobs,
    ws_jobs_context,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

# Backwards-compatible re-exports for tests that import these directly.
__all__ = [
    "_global_jobs_cache",
    "_workspace_jobs_cache",
    "get_workspace_jobs",
    "serialize_workspace_jobs",
    "job_definition_to_dict",
    "router",
]


@router.get("/jobs/workspaces")
def list_all_workspace_jobs():
    all_config = load_all_config()
    global_jobs_data = all_config.get(GLOBAL_CONFIG_KEY, {}).get("jobs", {})
    result = {}
    for name in sorted(all_config.keys()):
        if name == GLOBAL_CONFIG_KEY or not isinstance(all_config[name], dict):
            continue
        ws_jobs_data = all_config[name].get("jobs", {})
        merged = {}
        for is_global, jobs_data in [(True, global_jobs_data), (False, ws_jobs_data)]:
            for jname, entry in jobs_data.items():
                merged[jname] = (entry_to_job_definition(jname, entry), is_global)
        result[name] = {
            jname: job_definition_to_dict(jdef, is_global=is_global)
            for jname, (jdef, is_global) in merged.items()
        }
    return result


@router.get("/workspaces/{name}/jobs")
def list_workspace_jobs(name: str):
    resolve_workspace_path(name)
    return serialize_workspace_jobs(name)


@router.get("/workspaces/{name}/jobs/{job_name}")
def get_workspace_job(name: str, job_name: str):
    resolve_workspace_path(name)
    jobs = get_workspace_jobs(name)
    entry = jobs.get(job_name)
    if not entry:
        raise not_found(f"Job '{job_name}' not found")
    job_def, _ = entry
    return job_definition_to_dict(job_def)


@router.post("/workspaces/{name}/jobs")
def create_workspace_job(name: str, body: JobRequest):
    data, save_fn, _ = ws_jobs_context(name)
    return save_job(data, save_fn, None, body, "job created workspace=%s job=%%s" % name)


@router.put("/workspaces/{name}/job-order")
def reorder_workspace_jobs(name: str, body: ReorderJobsRequest):
    data, save_fn, _ = ws_jobs_context(name)
    return reorder_jobs(data, save_fn, body.order, "jobs reordered workspace=%s count=%%d" % name)


@router.put("/workspaces/{name}/jobs/{job_name}")
def update_workspace_job(name: str, job_name: str, body: JobRequest):
    data, save_fn, label = ws_jobs_context(name)
    if job_name not in data:
        raise not_found(f"{label} '{job_name}' not found")
    return save_job(data, save_fn, job_name, body, "job updated workspace=%s job=%%s" % name)


@router.delete("/workspaces/{name}/jobs/{job_name}")
def delete_workspace_job(name: str, job_name: str):
    data, save_fn, label = ws_jobs_context(name)
    return delete_job(data, save_fn, job_name,
                      f"{label} '{job_name}' not found",
                      "job deleted workspace=%s job=%%s" % name)


@router.get("/global/jobs")
def list_global_jobs():
    data = load_global_jobs_data()
    jobs = parse_jobs_data(data)
    return {jname: job_definition_to_dict(jdef) for jname, jdef in jobs.items()}


@router.post("/global/jobs")
def create_global_job(body: JobRequest):
    data, save_fn, _ = global_jobs_context()
    return save_job(data, save_fn, None, body, "global job created job=%s")


@router.put("/global/jobs/{job_name}")
def update_global_job(job_name: str, body: JobRequest):
    data, save_fn, label = global_jobs_context()
    if job_name not in data:
        raise not_found(f"{label} '{job_name}' not found")
    return save_job(data, save_fn, job_name, body, "global job updated job=%s")


@router.delete("/global/jobs/{job_name}")
def delete_global_job(job_name: str):
    data, save_fn, label = global_jobs_context()
    return delete_job(data, save_fn, job_name,
                      f"{label} '{job_name}' not found",
                      "global job deleted job=%s")


@router.put("/global/job-order")
def reorder_global_jobs(body: ReorderJobsRequest):
    data, save_fn, _ = global_jobs_context()
    return reorder_jobs(data, save_fn, body.order, "global jobs reordered count=%d")
