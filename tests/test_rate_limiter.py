"""レートリミッター・ジョブ実行のユニットテスト。"""

import time

import pytest

from api.rate_limiter import _FixedWindowCounter


class TestFixedWindowCounter:
    def test_最初のリクエストは許可される(self):
        c = _FixedWindowCounter()
        assert c.is_allowed("k", 5, 60) is True

    def test_リミット内は許可される(self):
        c = _FixedWindowCounter()
        for _ in range(5):
            assert c.is_allowed("k", 5, 60) is True

    def test_リミット超過で拒否される(self):
        c = _FixedWindowCounter()
        for _ in range(5):
            c.is_allowed("k", 5, 60)
        assert c.is_allowed("k", 5, 60) is False

    def test_異なるキーは独立してカウントされる(self):
        c = _FixedWindowCounter()
        for _ in range(5):
            c.is_allowed("a", 5, 60)
        assert c.is_allowed("a", 5, 60) is False
        assert c.is_allowed("b", 5, 60) is True

    def test_ウィンドウ経過後にリセットされる(self):
        c = _FixedWindowCounter()
        c.is_allowed("k", 1, 0.01)
        assert c.is_allowed("k", 1, 0.01) is False
        time.sleep(0.02)
        assert c.is_allowed("k", 1, 0.01) is True


class TestRateLimitMiddleware:
    """エンドポイント経由のレートリミットテスト"""

    def test_APIエンドポイントにレート制限が適用される(self, client, workspace):
        from conftest import AUTH
        from api.rate_limiter import _counter, RATE_LIMIT_GENERAL

        _counter._counts.clear()
        for _ in range(RATE_LIMIT_GENERAL):
            res = client.get("/workspaces/test-ws/status", headers=AUTH)
        res = client.get("/workspaces/test-ws/status", headers=AUTH)
        assert res.status_code == 429

    def test_authcheckはレート制限対象外(self, client):
        from conftest import AUTH
        from api.rate_limiter import _counter

        _counter._counts.clear()
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code != 429


class TestSkipMatcher:
    """_should_skip の判定パターン"""

    def test_API系パスはスキップしない(self):
        from api.rate_limiter import _should_skip

        for path in [
            "/workspaces",
            "/workspaces/test-ws/status",
            "/devices/register",
            "/auth/logout",
            "/jobs/foo/run",
            "/git/foo/branches",
            "/upload-image",
        ]:
            assert _should_skip(path) is False, path

    def test_静的アセットはスキップする(self):
        from api.rate_limiter import _should_skip

        for path in [
            "/assets/index-abc123.js",
            "/assets/style-abc123.css",
            "/icons/foo.png",
            "/styles/github-pane.css",
            "/utils/format.js",
            "/components/App.vue.js",
            "/sw.js",
            "/manifest.json",
            "/favicon.png",
            "/apple-touch-icon.png",
            "/",
            "/auth/check",
            "/terminal/ws/abc",
        ]:
            assert _should_skip(path) is True, path

    def test_紛らわしいAPIパスは誤判定しない(self):
        """以前の prefix ベース実装は /auth.<chunk>.js を狙って `/auth.` を
        SKIP_PREFIXES に入れていた結果、API パスとの混同が起きやすかった。
        新実装では拡張子ベースで判定するため、API はスキップされない。"""
        from api.rate_limiter import _should_skip

        assert _should_skip("/auth/check") is True
        assert _should_skip("/devices/register") is False
        assert _should_skip("/auth/logout") is False
