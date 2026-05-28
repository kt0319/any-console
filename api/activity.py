"""操作ログを data/activity/{workspace}/{YYYY-MM-DD}.jsonl に追記する。"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent / "data" / "activity"


def log_activity(workspace: str | None, event_type: str, **kwargs) -> None:
    ws = workspace or "_global"
    now = datetime.now(timezone.utc)
    entry = {"t": now.strftime("%Y-%m-%dT%H:%M:%S"), "type": event_type, **kwargs}
    path = _BASE / ws / f"{now.strftime('%Y-%m-%d')}.jsonl"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        logger.warning("activity log write failed ws=%s type=%s", ws, event_type)
