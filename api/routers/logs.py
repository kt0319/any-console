from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from ..auth import verify_token
from ..common import LOG_BUFFER, OPERATION_LOG

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/logs")
def get_logs():
    return list(LOG_BUFFER.entries)


@router.delete("/logs")
def clear_logs():
    LOG_BUFFER.clear()
    return {"status": "ok"}


@router.get("/op-logs")
def get_op_logs():
    return list(OPERATION_LOG.entries)


@router.delete("/op-logs")
def clear_op_logs():
    OPERATION_LOG.clear()
    return {"status": "ok"}


@router.post("/logs/client")
async def receive_client_log(request: Request):
    body = await request.json()
    LOG_BUFFER.add({
        "ts": datetime.now(timezone.utc).isoformat(),
        "method": "CLIENT",
        "path": body.get("source", ""),
        "status_code": 0,
        "duration_ms": 0,
        "detail": body.get("message", ""),
    })
    return {"status": "ok"}
