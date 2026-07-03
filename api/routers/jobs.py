"""ワークスペースジョブ / 共通ジョブの CRUD エンドポイント。

ジョブ実行（/run）は `job_runner.py`、共通ロジックは `jobs_common.py` を参照。
"""

import logging

from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, resolve_workspace_path
from ..config import iter_workspace_entries_from, load_all_config
from ..errors import not_found
from .jobs_common import (
    JobRequest,
    ReorderJobsRequest,
    common_jobs_context,
    delete_job,
    entry_to_job_definition,
    get_workspace_jobs,
    job_definition_to_dict,
    load_common_jobs_data,
    parse_jobs_data,
    reorder_jobs,
    save_job,
    serialize_workspace_jobs,
    ws_jobs_context,
)
from .workspaces import _dynamic_worktree_entries

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def _merge_jobs_for_ws(display_name, ws_jobs_data, common_jobs_data):
    merged = {}
    for is_common, jobs_data in [(True, common_jobs_data), (False, ws_jobs_data)]:
        for jname, jentry in jobs_data.items():
            merged[jname] = (entry_to_job_definition(jname, jentry), is_common)
    return display_name, {
        jname: job_definition_to_dict(jdef, is_common=is_common)
        for jname, (jdef, is_common) in merged.items()
    }


@router.get("/jobs/workspaces")
def list_all_workspace_jobs():
    all_config = load_all_config()
    common_jobs_data = all_config.get(GLOBAL_CONFIG_KEY, {}).get("jobs", {})
    entries = list(iter_workspace_entries_from(all_config))
    jobs_by_name = {(entry.get("name") or ws_id): entry.get("jobs", {}) for ws_id, entry in entries}
    result = {}
    for ws_id, entry in sorted(entries):
        base = entry.get("worktree_base")
        ws_jobs_data = jobs_by_name[base] if base and base in jobs_by_name else entry.get("jobs", {})
        display_name, serialized = _merge_jobs_for_ws(entry.get("name") or ws_id, ws_jobs_data, common_jobs_data)
        result[display_name] = serialized
    for wt in _dynamic_worktree_entries():
        if wt["name"] in result:
            continue
        wt_jobs = jobs_by_name.get(wt.get("worktree_base", ""), {})
        _, serialized = _merge_jobs_for_ws(wt["name"], wt_jobs, common_jobs_data)
        result[wt["name"]] = serialized
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


@router.get("/common/jobs")
def list_common_jobs():
    data = load_common_jobs_data()
    jobs = parse_jobs_data(data)
    return {jname: job_definition_to_dict(jdef) for jname, jdef in jobs.items()}


@router.post("/common/jobs")
def create_common_job(body: JobRequest):
    data, save_fn, _ = common_jobs_context()
    return save_job(data, save_fn, None, body, "common job created job=%s")


@router.put("/common/jobs/{job_name}")
def update_common_job(job_name: str, body: JobRequest):
    data, save_fn, label = common_jobs_context()
    if job_name not in data:
        raise not_found(f"{label} '{job_name}' not found")
    return save_job(data, save_fn, job_name, body, "common job updated job=%s")


@router.delete("/common/jobs/{job_name}")
def delete_common_job(job_name: str):
    data, save_fn, label = common_jobs_context()
    return delete_job(data, save_fn, job_name,
                      f"{label} '{job_name}' not found",
                      "common job deleted job=%s")


@router.put("/common/job-order")
def reorder_common_jobs(body: ReorderJobsRequest):
    data, save_fn, _ = common_jobs_context()
    return reorder_jobs(data, save_fn, body.order, "common jobs reordered count=%d")
