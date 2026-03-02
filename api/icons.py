import base64
import hashlib
import logging
import re

from .common import PROJECT_ROOT

logger = logging.getLogger(__name__)

ICONS_DIR = PROJECT_ROOT / "data" / "icons"
ICON_FILE_PATTERN = re.compile(r"^icon:[a-f0-9]{16}\.(png|jpg|gif|webp|svg)$")

MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}

DATA_URI_RE = re.compile(r"^data:(image/[a-z+]+);base64,(.+)$", re.DOTALL)


def normalize_icon(icon: str) -> str:
    m = DATA_URI_RE.match(icon)
    if not m:
        return icon

    mime_type = m.group(1)
    b64_data = m.group(2)

    ext = MIME_TO_EXT.get(mime_type)
    if not ext:
        return icon

    raw = base64.b64decode(b64_data)
    digest = hashlib.sha256(raw).hexdigest()[:16]
    filename = f"{digest}.{ext}"

    dest = ICONS_DIR / filename
    if not dest.exists():
        ICONS_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        logger.info("icon saved file=%s size=%d", filename, len(raw))

    return f"icon:{filename}"
