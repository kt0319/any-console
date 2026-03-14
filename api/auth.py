import hmac
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()

ANY_CONSOLE_TOKEN = os.environ.get("ANY_CONSOLE_TOKEN", "")


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    if not ANY_CONSOLE_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANY_CONSOLE_TOKEN is not configured",
        )
    if not hmac.compare_digest(credentials.credentials, ANY_CONSOLE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    return credentials.credentials
