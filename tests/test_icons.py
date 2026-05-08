"""api/icons.py のテスト。"""

import base64
import urllib.error
from unittest import mock

import pytest


class TestSaveIconBytes:
    def test_saves_file_and_returns_icon_ref(self, tmp_path, monkeypatch):
        from api import icons
        monkeypatch.setattr(icons, "ICONS_DIR", tmp_path / "icons")
        raw = b"fake_png_bytes"
        result = icons._save_icon_bytes(raw, "png")
        assert result.startswith("icon:")
        assert result.endswith(".png")

    def test_idempotent_for_same_bytes(self, tmp_path, monkeypatch):
        from api import icons
        monkeypatch.setattr(icons, "ICONS_DIR", tmp_path / "icons")
        raw = b"fake_png_bytes"
        assert icons._save_icon_bytes(raw, "png") == icons._save_icon_bytes(raw, "png")

    def test_creates_icons_dir_if_not_exists(self, tmp_path, monkeypatch):
        from api import icons
        icons_dir = tmp_path / "new_icons"
        monkeypatch.setattr(icons, "ICONS_DIR", icons_dir)
        icons._save_icon_bytes(b"data", "png")
        assert icons_dir.exists()


class TestNormalizeIcon:
    def test_data_uri_png_saved(self, tmp_path, monkeypatch):
        from api import icons
        monkeypatch.setattr(icons, "ICONS_DIR", tmp_path / "icons")
        raw = b"\x89PNG\r\n\x1a\n"
        data_uri = f"data:image/png;base64,{base64.b64encode(raw).decode()}"
        result = icons.normalize_icon(data_uri)
        assert result.startswith("icon:")

    def test_data_uri_unknown_mime_passthrough(self):
        from api import icons
        raw = b"data"
        data_uri = f"data:image/bmp;base64,{base64.b64encode(raw).decode()}"
        assert icons.normalize_icon(data_uri) == data_uri

    def test_non_data_uri_passthrough(self):
        from api import icons
        assert icons.normalize_icon("mdi-home") == "mdi-home"


class TestDownloadFavicon:
    def test_success(self, tmp_path, monkeypatch):
        from api import icons
        monkeypatch.setattr(icons, "ICONS_DIR", tmp_path / "icons")
        raw = b"fake_png"
        mock_resp = mock.MagicMock()
        mock_resp.headers.get.return_value = "image/png"
        mock_resp.read.return_value = raw
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = mock.MagicMock(return_value=False)
        with mock.patch("urllib.request.urlopen", return_value=mock_resp):
            result = icons._download_favicon("example.com", "fallback")
        assert result.startswith("icon:")

    def test_url_error_returns_fallback(self):
        from api import icons
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timeout")):
            result = icons._download_favicon("example.com", "fallback")
        assert result == "fallback"

    def test_os_error_returns_fallback(self):
        from api import icons
        with mock.patch("urllib.request.urlopen", side_effect=OSError("connection refused")):
            result = icons._download_favicon("example.com", "fallback")
        assert result == "fallback"
