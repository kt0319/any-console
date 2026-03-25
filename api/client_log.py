import logging

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .auth import _extract_client_ip, resolve_tailscale_name

logger = logging.getLogger(__name__)

_MUTATION_METHODS = {"POST", "PUT", "DELETE", "PATCH"}

_SKIP_PATHS = {"/auth/check"}


class ClientLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if request.method not in _MUTATION_METHODS:
            return response

        path = request.url.path
        if path in _SKIP_PATHS:
            return response

        client_ip = _extract_client_ip(request)
        client_name = resolve_tailscale_name(client_ip) or client_ip
        logger.info(
            "client=%s method=%s path=%s status=%d",
            client_name, request.method, path, response.status_code,
        )
        return response
