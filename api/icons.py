import base64
import hashlib
import logging
import re
import urllib.request

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

FAVICON_PREFIX = "favicon:"
GOOGLE_FAVICON_URL = "https://www.google.com/s2/favicons?domain={domain}&sz=64"


def _save_icon_bytes(raw: bytes, ext: str) -> str:
    digest = hashlib.sha256(raw).hexdigest()[:16]
    filename = f"{digest}.{ext}"
    dest = ICONS_DIR / filename
    if not dest.exists():
        ICONS_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        logger.info("icon saved file=%s size=%d", filename, len(raw))
    return f"icon:{filename}"


def normalize_icon(icon: str) -> str:
    if icon.startswith(FAVICON_PREFIX):
        return _download_favicon(icon[len(FAVICON_PREFIX):], icon)

    m = DATA_URI_RE.match(icon)
    if not m:
        return icon

    mime_type = m.group(1)
    b64_data = m.group(2)

    ext = MIME_TO_EXT.get(mime_type)
    if not ext:
        return icon

    raw = base64.b64decode(b64_data)
    return _save_icon_bytes(raw, ext)


def _download_favicon(domain: str, fallback: str) -> str:
    url = GOOGLE_FAVICON_URL.format(domain=urllib.request.quote(domain))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pi-console/1.0"})  # noqa: S310
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()
        ext = MIME_TO_EXT.get(content_type.split(";")[0].strip(), "png")
        logger.info("favicon downloaded domain=%s size=%d", domain, len(raw))
        return _save_icon_bytes(raw, ext)
    except Exception:
        logger.warning("favicon download failed domain=%s", domain, exc_info=True)
        return fallback
