import base64
import logging
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import TTLCache
from ..config import load_workspace_config_section, save_workspace_config_section
from ..validators import validate_workspace_name

router = APIRouter(dependencies=[Depends(verify_token)])
logger = logging.getLogger(__name__)

_RSS_TTL_SEC = 10 * 60
_RSS_FETCH_TIMEOUT_SEC = 10
_rss_cache = TTLCache(_RSS_TTL_SEC)

_ATOM_NS = "http://www.w3.org/2005/Atom"


def _fetch_feed_items(feed_id: str, url: str) -> tuple[list[dict], str]:
    cache_key = f"rss:{feed_id}"
    cached = _rss_cache.get(cache_key)
    if cached is not None:
        return list(cached), ""

    try:
        parsed = urllib.parse.urlparse(url)
        headers: dict[str, str] = {"User-Agent": "any-console/1.0"}
        if parsed.username:
            creds = f"{urllib.parse.unquote(parsed.username)}:{urllib.parse.unquote(parsed.password or '')}"
            headers["Authorization"] = "Basic " + base64.b64encode(creds.encode()).decode()
            clean = parsed._replace(netloc=parsed.hostname + (f":{parsed.port}" if parsed.port else ""))
            fetch_url = urllib.parse.urlunparse(clean)
        else:
            fetch_url = url
        req = urllib.request.Request(fetch_url, headers=headers)  # noqa: S310
        with urllib.request.urlopen(req, timeout=_RSS_FETCH_TIMEOUT_SEC) as resp:  # noqa: S310
            content = resp.read()
    except urllib.error.HTTPError as e:
        logger.warning("rss fetch failed url=%s status=%s", url, e.code)
        return [], f"HTTP {e.code}: {e.reason}"
    except Exception as e:
        logger.warning("rss fetch failed url=%s error=%s", url, e)
        return [], str(e)

    try:
        root = ET.fromstring(content)  # noqa: S314
    except ET.ParseError as e:
        logger.warning("rss parse failed url=%s error=%s", url, e)
        return [], f"Parse error: {e}"

    items = _parse_feed(root, feed_id, url)
    _rss_cache.set(cache_key, items)
    return items, ""


def _norm_date(raw: str) -> str:
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).isoformat()
    except Exception:
        return raw


def _parse_feed(root: ET.Element, feed_id: str, url: str) -> list[dict]:
    tag = root.tag
    if tag == f"{{{_ATOM_NS}}}feed" or tag == "feed":
        return _parse_atom(root, feed_id, url)
    return _parse_rss(root, feed_id, url)


def _parse_atom(root: ET.Element, feed_id: str, url: str) -> list[dict]:
    ns = {"a": _ATOM_NS}
    feed_title = root.findtext("a:title", namespaces=ns) or url
    items = []
    for entry in root.findall("a:entry", ns):
        link_el = entry.find("a:link", ns)
        link = (link_el.get("href") if link_el is not None else "") or ""
        items.append({
            "feed_id": feed_id,
            "feed_title": feed_title,
            "title": (entry.findtext("a:title", namespaces=ns) or "").strip(),
            "url": link.strip(),
            "date": entry.findtext("a:published", namespaces=ns) or entry.findtext("a:updated", namespaces=ns) or "",
            "summary": (entry.findtext("a:summary", namespaces=ns) or "").strip(),
        })
    return items


def _parse_rss(root: ET.Element, feed_id: str, url: str) -> list[dict]:
    channel = root.find("channel")
    if channel is None:
        return []
    feed_title = channel.findtext("title") or url
    items = []
    for item in channel.findall("item"):
        items.append({
            "feed_id": feed_id,
            "feed_title": feed_title,
            "title": (item.findtext("title") or "").strip(),
            "url": (item.findtext("link") or "").strip(),
            "date": _norm_date(item.findtext("pubDate") or ""),
            "summary": (item.findtext("description") or "").strip(),
        })
    return items


def _get_feeds(name: str) -> list[dict]:
    return list(load_workspace_config_section(name, "rss_feeds", []))


def _save_feeds(name: str, feeds: list[dict]) -> None:
    save_workspace_config_section(name, "rss_feeds", feeds)


@router.get("/workspaces/{name}/rss/feeds")
def list_feeds(name: str):
    validate_workspace_name(name)
    return {"status": "ok", "data": _get_feeds(name)}


class AddFeedRequest(BaseModel):
    url: str
    title: str = ""


@router.post("/workspaces/{name}/rss/feeds")
def add_feed(name: str, body: AddFeedRequest):
    validate_workspace_name(name)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        return {"status": "error", "detail": "Invalid URL"}
    feeds = _get_feeds(name)
    if any(f["url"] == url for f in feeds):
        return {"status": "error", "detail": "Feed already exists"}
    feed_id = str(uuid.uuid4())[:8]
    entry: dict = {"id": feed_id, "url": url}
    if body.title.strip():
        entry["title"] = body.title.strip()
    feeds.append(entry)
    _save_feeds(name, feeds)
    logger.info("rss feed added workspace=%s url=%s", name, url)
    return {"status": "ok", "data": entry}


class UpdateFeedRequest(BaseModel):
    url: str = ""
    title: str = ""


@router.patch("/workspaces/{name}/rss/feeds/{feed_id}")
def update_feed(name: str, feed_id: str, body: UpdateFeedRequest):
    validate_workspace_name(name)
    url = body.url.strip()
    if url and not url.startswith(("http://", "https://")):
        return {"status": "error", "detail": "Invalid URL"}
    feeds = _get_feeds(name)
    for f in feeds:
        if f["id"] == feed_id:
            if url:
                f["url"] = url
                _rss_cache.invalidate(f"rss:{feed_id}")
            f["title"] = body.title.strip()
            break
    _save_feeds(name, feeds)
    logger.info("rss feed updated workspace=%s feed_id=%s", name, feed_id)
    return {"status": "ok"}


@router.delete("/workspaces/{name}/rss/feeds/{feed_id}")
def remove_feed(name: str, feed_id: str):
    validate_workspace_name(name)
    feeds = _get_feeds(name)
    feeds = [f for f in feeds if f["id"] != feed_id]
    _save_feeds(name, feeds)
    _rss_cache.invalidate(f"rss:{feed_id}")
    logger.info("rss feed removed workspace=%s feed_id=%s", name, feed_id)
    return {"status": "ok"}


@router.get("/workspaces/{name}/rss/items")
def fetch_items(name: str):
    validate_workspace_name(name)
    feeds = _get_feeds(name)
    all_items: list[dict] = []
    errors: dict[str, str] = {}
    for feed in feeds:
        items, error = _fetch_feed_items(feed["id"], feed["url"])
        all_items.extend(items)
        if error:
            errors[feed["id"]] = error
    all_items.sort(key=lambda x: x.get("date", ""), reverse=True)
    return {"status": "ok", "data": all_items, "errors": errors}
