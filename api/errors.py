from fastapi import HTTPException


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


def not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


def gone(detail: str) -> HTTPException:
    return HTTPException(status_code=410, detail=detail)


def too_large(detail: str) -> HTTPException:
    return HTTPException(status_code=413, detail=detail)


def too_many_requests(detail: str) -> HTTPException:
    return HTTPException(status_code=429, detail=detail)


def server_error(detail: str) -> HTTPException:
    return HTTPException(status_code=500, detail=detail)


def timeout_error(detail: str) -> HTTPException:
    return HTTPException(status_code=504, detail=detail)
