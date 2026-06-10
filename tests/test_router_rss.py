"""api/routers/rss.py のテスト。"""
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import pytest

from conftest import AUTH


RSS_FEED_XML = b"""<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Item 1</title>
      <link>https://example.com/item1</link>
      <pubDate>Thu, 01 Jan 2026 10:00:00 +0000</pubDate>
      <description>Summary 1</description>
    </item>
    <item>
      <title>Item 2</title>
      <link>https://example.com/item2</link>
    </item>
    <item>
      <link></link>
    </item>
  </channel>
</rss>"""

ATOM_FEED_XML = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Item</title>
    <link href="https://example.com/atom1"/>
    <published>2026-01-01T10:00:00Z</published>
    <summary>Atom summary</summary>
  </entry>
</feed>"""

ATOM_FEED_XML_NO_NS = b"""<?xml version="1.0"?>
<feed>
  <title xmlns="http://www.w3.org/2005/Atom">No NS Feed</title>
  <entry xmlns="http://www.w3.org/2005/Atom">
    <title>Entry</title>
    <link href="https://example.com/entry"/>
    <published>2026-01-01T00:00:00Z</published>
  </entry>
</feed>"""

INVALID_XML = b"not xml at all <<<"


def _mock_urlopen(content):
    mock_resp = MagicMock()
    mock_resp.read.return_value = content
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


class TestFeedCrud:
    def test_list_feeds_empty(self, client, workspace):
        res = client.get("/workspaces/test-ws/rss/feeds", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "data": []}

    def test_add_feed(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rss/feeds",
            headers=AUTH,
            json={"url": "https://example.com/feed"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"]["url"] == "https://example.com/feed"
        assert "id" in data["data"]

    def test_add_feed_with_title(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rss/feeds",
            headers=AUTH,
            json={"url": "https://example.com/feed", "title": "My Feed"},
        )
        assert res.status_code == 200
        assert res.json()["data"]["title"] == "My Feed"

    def test_add_feed_invalid_url(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rss/feeds",
            headers=AUTH,
            json={"url": "ftp://bad.url"},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Invalid URL"

    def test_add_feed_duplicate(self, client, workspace):
        url = "https://example.com/feed"
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": url})
        res = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": url})
        assert res.status_code == 409
        assert "already" in res.json()["detail"]

    def test_list_feeds_after_add(self, client, workspace):
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f1"})
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f2"})
        res = client.get("/workspaces/test-ws/rss/feeds", headers=AUTH)
        assert len(res.json()["data"]) == 2

    def test_update_feed_title(self, client, workspace):
        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f"})
        feed_id = add.json()["data"]["id"]
        res = client.patch(
            f"/workspaces/test-ws/rss/feeds/{feed_id}",
            headers=AUTH,
            json={"title": "New Title"},
        )
        assert res.json()["status"] == "ok"

    def test_update_feed_url(self, client, workspace):
        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f"})
        feed_id = add.json()["data"]["id"]
        res = client.patch(
            f"/workspaces/test-ws/rss/feeds/{feed_id}",
            headers=AUTH,
            json={"url": "https://example.com/new", "title": ""},
        )
        assert res.json()["status"] == "ok"

    def test_update_feed_invalid_url(self, client, workspace):
        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f"})
        feed_id = add.json()["data"]["id"]
        res = client.patch(
            f"/workspaces/test-ws/rss/feeds/{feed_id}",
            headers=AUTH,
            json={"url": "ftp://bad"},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Invalid URL"

    def test_update_feed_not_found(self, client, workspace):
        res = client.patch(
            "/workspaces/test-ws/rss/feeds/nonexistent",
            headers=AUTH,
            json={"title": "x"},
        )
        assert res.status_code == 404
        assert res.json()["detail"] == "Feed not found"

    def test_remove_feed(self, client, workspace):
        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/f"})
        feed_id = add.json()["data"]["id"]
        res = client.delete(f"/workspaces/test-ws/rss/feeds/{feed_id}", headers=AUTH)
        assert res.json()["status"] == "ok"
        feeds = client.get("/workspaces/test-ws/rss/feeds", headers=AUTH).json()["data"]
        assert all(f["id"] != feed_id for f in feeds)


class TestFetchItems:
    def test_fetch_items_no_feeds(self, client, workspace):
        res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "data": [], "errors": {}}

    def test_fetch_rss_items(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})
        feed_id = add.json()["data"]["id"]

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(RSS_FEED_XML)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        # item with empty title+link is skipped; item with only link is kept
        items = data["data"]
        assert any(i["title"] == "Item 1" for i in items)
        assert any(i["title"] == "Item 2" for i in items)
        assert all(i["feed_id"] == feed_id for i in items)

    def test_fetch_atom_items(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/atom"})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(ATOM_FEED_XML)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        items = res.json()["data"]
        assert any(i["title"] == "Atom Item" for i in items)

    def test_fetch_http_error(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})
        feed_id = add.json()["data"]["id"]

        http_err = HTTPError("https://example.com/feed", 401, "Unauthorized", {}, None)
        with patch("urllib.request.urlopen", side_effect=http_err):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        data = res.json()
        assert data["status"] == "ok"
        assert feed_id in data["errors"]
        assert "401" in data["errors"][feed_id]

    def test_fetch_network_error(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})
        feed_id = add.json()["data"]["id"]

        with patch("urllib.request.urlopen", side_effect=URLError("connection refused")):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert feed_id in res.json()["errors"]

    def test_fetch_invalid_xml(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        add = client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})
        feed_id = add.json()["data"]["id"]

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(INVALID_XML)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert feed_id in res.json()["errors"]

    def test_fetch_uses_cache(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(RSS_FEED_XML)) as mock_open:
            client.get("/workspaces/test-ws/rss/items", headers=AUTH)
            client.get("/workspaces/test-ws/rss/items", headers=AUTH)
            assert mock_open.call_count == 1

    def test_fetch_with_basic_auth_url(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        url = "https://user:pass@example.com/feed"
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": url})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(RSS_FEED_XML)) as mock_open:
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert res.status_code == 200
        req_arg = mock_open.call_args[0][0]
        assert "user" not in req_arg.full_url
        assert req_arg.get_header("Authorization").startswith("Basic ")

    def test_fetch_with_basic_auth_url_with_port(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        url = "https://user:pass@example.com:8080/feed"
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": url})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(RSS_FEED_XML)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert res.status_code == 200

    def test_items_sorted_by_date_desc(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(RSS_FEED_XML)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        items = res.json()["data"]
        dates = [i["date"] for i in items if i["date"]]
        assert dates == sorted(dates, reverse=True)

    def test_rss_no_channel(self, client, workspace):
        from api.routers import rss as rss_mod
        rss_mod._rss_cache.invalidate_all()

        no_channel_xml = b"<rss><item><title>x</title></item></rss>"
        client.post("/workspaces/test-ws/rss/feeds", headers=AUTH, json={"url": "https://example.com/feed"})

        with patch("urllib.request.urlopen", return_value=_mock_urlopen(no_channel_xml)):
            res = client.get("/workspaces/test-ws/rss/items", headers=AUTH)

        assert res.json()["data"] == []


class TestNormDate:
    def test_norm_valid_rfc2822(self):
        from api.routers.rss import _norm_date
        result = _norm_date("Thu, 01 Jan 2026 10:00:00 +0000")
        assert "2026" in result

    def test_norm_empty(self):
        from api.routers.rss import _norm_date
        assert _norm_date("") == ""

    def test_norm_invalid_fallback(self):
        from api.routers.rss import _norm_date
        result = _norm_date("not a date")
        assert result == "not a date"


class TestInvalidWorkspaceName:
    def test_invalid_name_rejected(self, client):
        res = client.get("/workspaces/../etc/rss/feeds", headers=AUTH)
        assert res.status_code in (400, 422, 404)
