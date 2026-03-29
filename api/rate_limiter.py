import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

RATE_LIMIT_GENERAL = 200
RATE_WINDOW_SEC = 60

SKIP_PREFIXES = (
    "/ui/",
    "/assets/",
    "/icons/",
    "/styles",
    "/vendor/",
    "/favicon",
    "/sw.js",
    "/manifest",
    "/icon-",
    "/app.",
    "/state.",
    "/auth.",
    "/workspace.",
    "/git.",
    "/jobs.",
    "/terminal.",
    "/settings.",
    "/quick-input.",
    "/icon-picker.",
    "/utils.",
    "/auth/check",
    "/terminal/ws/",
)


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
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        if any(path.startswith(p) for p in SKIP_PREFIXES):
            return await call_next(request)
        if path == "/" and request.method == "GET":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        limit = RATE_LIMIT_GENERAL
        key = f"api:{client_ip}"

        if not _counter.is_allowed(key, limit, RATE_WINDOW_SEC):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"},
            )

        return await call_next(request)
