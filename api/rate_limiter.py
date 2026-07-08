import os
import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return default


# E2E テスト等で連続アクセスが上限を超える場合に環境変数で引き上げられる
# （通常運用では未設定のまま既定値を使う）。
RATE_LIMIT_GENERAL = _env_int("ANY_CONSOLE_RATE_LIMIT", 200)
RATE_WINDOW_SEC = 60

# Static asset directories. Matched as path prefix.
_STATIC_DIRS = (
    "/assets/",
    "/icons/",
    "/styles/",
    "/utils/",
    "/components/",
    "/composables/",
    "/stores/",
    "/vendor/",
    "/public/",
)

# Static file extensions. Matched as path suffix.
_STATIC_SUFFIXES = (
    ".js", ".mjs", ".css", ".map",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".otf",
)

# Endpoints intentionally excluded from rate limiting. Polled by the UI
# (connectivity monitor) so a flat allow-list is clearer than prefix matching.
_SKIP_EXACT = frozenset({
    "/",
    "/sw.js",
    "/manifest.json",
    "/favicon.png",
    "/apple-touch-icon.png",
    "/auth/check",
})

# WebSocket paths bypass the HTTP rate limiter; the WS handshake itself is rare.
_SKIP_WS_PREFIXES = ("/terminal/ws/", "/preview/")  # noqa: S105
# 注: /preview/ は HTTP proxy 経由のアプリ資産（JS/CSS/HMR）が大量に流れるため、
# ここで rate limit に掛けると Vite や Next.js が壊れる。loopback への proxy なので
# 認可は preview router 側の verify_token に任せ、レート制限は外す。


def _should_skip(path: str) -> bool:
    if path in _SKIP_EXACT:
        return True
    if any(path.startswith(p) for p in _STATIC_DIRS):
        return True
    if any(path.startswith(p) for p in _SKIP_WS_PREFIXES):
        return True
    if any(path.endswith(s) for s in _STATIC_SUFFIXES):
        return True
    return False


class _FixedWindowCounter:
    __slots__ = ("_counts",)

    def __init__(self):
        self._counts: dict[str, tuple[float, int]] = {}

    def is_allowed(self, key: str, limit: int, window: int) -> bool:
        now = time.monotonic()
        entry = self._counts.get(key)
        if entry is None or now - entry[0] >= window:
            self._counts[key] = (now, 1)
            return True
        if entry[1] >= limit:
            return False
        self._counts[key] = (entry[0], entry[1] + 1)
        return True


_counter = _FixedWindowCounter()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if _should_skip(request.url.path):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        key = f"api:{client_ip}"

        if not _counter.is_allowed(key, RATE_LIMIT_GENERAL, RATE_WINDOW_SEC):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"},
            )

        return await call_next(request)
