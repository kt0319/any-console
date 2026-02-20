import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()

PI_CONSOLE_TOKEN = os.environ.get("PI_CONSOLE_TOKEN", "")


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    if not PI_CONSOLE_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PI_CONSOLE_TOKEN is not configured",
        )
    if credentials.credentials != PI_CONSOLE_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    return credentials.credentials
