from fastapi import HTTPException


def _http_error(status_code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)


def bad_request(detail: str) -> HTTPException: return _http_error(400, detail)
def unauthorized(detail: str) -> HTTPException: return _http_error(401, detail)
def forbidden(detail: str) -> HTTPException: return _http_error(403, detail)
def not_found(detail: str) -> HTTPException: return _http_error(404, detail)
def conflict(detail: str) -> HTTPException: return _http_error(409, detail)
def gone(detail: str) -> HTTPException: return _http_error(410, detail)
def too_large(detail: str) -> HTTPException: return _http_error(413, detail)
def too_many_requests(detail: str) -> HTTPException: return _http_error(429, detail)
def server_error(detail: str) -> HTTPException: return _http_error(500, detail)
def timeout_error(detail: str) -> HTTPException: return _http_error(504, detail)
