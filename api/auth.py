import hmac
import ipaddress
import logging
import os
import secrets
from pathlib import Path
from typing import Mapping, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .common import load_json_file, save_json_file

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

_AUTH_FILE = Path(__file__).resolve().parent.parent / "data" / "auth.json"

COOKIE_DEVICE_ID = "any_console_device"  # noqa: S105
COOKIE_DEVICE_SECRET = "any_console_secret"  # noqa: S105

# Tailscale Serve / tailscaled が upstream に付与するヘッダ。
# 受信した HTTP ヘッダにこれが含まれていれば「Tailscale 経由で認証済みのユーザ」だが、
# 信頼するのは trusted な接続元（loopback または Tailscale CGNAT 範囲）からのみ。
# 任意のクライアントが付けられるヘッダなので、信頼ソースの判定なしに使うと危険。
#
# さらに接続元判定だけでは防げない構成がある: Tailscale 以外のトンネル・プロキシ
# （ssh -L / cloudflared / XFF を付けない nginx 等）を同ホストに立てると、外部からの
# リクエストが loopback 発として届き、偽装ヘッダで認証を素通しできてしまう。
# tailnet 上の他端末（CGNAT 帯）も Serve を経由せず直接ヘッダを付けられる。
# このため Tailscale ヘッダによる自動認証は opt-in とし、デフォルトでは信頼しない。
TAILSCALE_HEADER_USER = "tailscale-user-login"
TAILSCALE_HEADER_NAME = "tailscale-user-name"
ENV_TRUST_TAILSCALE = "ANY_CONSOLE_TRUST_TAILSCALE_AUTH"
# 100.64.0.0/10 は CGNAT 帯。Tailscale は tailnet 内の各端末にこの範囲を割り当てる。
# Tailscale Serve / Funnel 経由のリクエストは tailscaled が同ホスト loopback に
# プロキシするケースが多いため、loopback も信頼ソースに含める。
_TAILSCALE_CGNAT = ipaddress.ip_network("100.64.0.0/10")
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _load_token_from_file() -> str:
    data = load_json_file(_AUTH_FILE, {})
    token = data.get("token", "") if isinstance(data, dict) else ""
    return str(token) if token else ""


ANY_CONSOLE_TOKEN: str = _load_token_from_file()


# 認証はリクエストごとに通るため、config 読み込みは初回のみ行い結果をキャッシュする。
# 変更（config.json の trust_tailscale_auth / 環境変数）の反映には再起動が必要。
_TRUST_TAILSCALE_CACHE: bool | None = None


def _is_tailscale_trust_enabled() -> bool:
    """Tailscale ヘッダによる自動認証が明示的に有効化されているか。

    デフォルトは無効。環境変数 ANY_CONSOLE_TRUST_TAILSCALE_AUTH=1 または
    config.json の __global__.trust_tailscale_auth: true で有効化する。
    無効時は Tailscale ヘッダを一切信頼せず、token / device cookie 認証に落ちる。
    """
    global _TRUST_TAILSCALE_CACHE
    if _TRUST_TAILSCALE_CACHE is None:
        if os.environ.get(ENV_TRUST_TAILSCALE, "").strip() == "1":
            _TRUST_TAILSCALE_CACHE = True
        else:
            try:
                from .config import load_global_config_section
                _TRUST_TAILSCALE_CACHE = bool(load_global_config_section("trust_tailscale_auth", False))
            except OSError:
                _TRUST_TAILSCALE_CACHE = False
    return _TRUST_TAILSCALE_CACHE


def _is_trusted_proxy_source(client_host: str) -> bool:
    """Tailscale ヘッダを信頼してよい接続元か判定する。

    Tailscale Serve / tailscaled は同ホスト loopback に upstream（このプロセス）を
    プロキシする使い方が一般的なので、loopback を信頼する。tailnet 上の他端末から
    直接アクセスする構成（any-console を 100.x.x.x にバインド）にも対応するため
    CGNAT 帯（100.64.0.0/10）も信頼する。

    192.168.x や public IP は Tailscale 経由ではない経路なので、これらの接続元から
    送られた Tailscale-User-* ヘッダは偽装の可能性があり信頼してはならない。
    """
    if not client_host:
        return False
    if client_host in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(client_host) in _TAILSCALE_CGNAT
    except ValueError:
        return False


def _tailscale_user(client_host: str, headers: Mapping[str, str]) -> str | None:
    """信頼できる接続元からのリクエストに Tailscale-User-Login があれば返す。

    SECURITY: ヘッダ単独では信頼しない。まず opt-in（`_is_tailscale_trust_enabled`）
    を要求し、その上で `_is_trusted_proxy_source` で接続元を絞る。接続元判定だけでは
    loopback 上の非 Tailscale プロキシ経由の偽装を防げないため、デフォルトは無効。
    fastapi / starlette のヘッダ名は case-insensitive だが、テストの簡便さの
    ため小文字キーで参照する。
    """
    if not _is_tailscale_trust_enabled():
        return None
    if not _is_trusted_proxy_source(client_host):
        return None
    user = headers.get(TAILSCALE_HEADER_USER, "").strip()
    return user or None


def _authenticate(
    token: str,
    client_host: str,
    headers: Mapping[str, str] | None,
    cookies: Mapping[str, str] | None,
) -> str | None:
    """認証判定のコア（HTTP / WS 共通）。

    Tailscale ヘッダ → デバイス cookie → Bearer token の順に判定し、
    成功なら「誰として認証されたか」の識別子文字列、失敗なら None を返す。
    """
    if not ANY_CONSOLE_TOKEN:
        return ""
    if headers is not None:
        ts_user = _tailscale_user(client_host, headers)
        if ts_user:
            return f"tailscale:{ts_user}"
    if cookies is not None:
        from .devices import verify_device
        dev = verify_device(cookies.get(COOKIE_DEVICE_ID, ""), cookies.get(COOKIE_DEVICE_SECRET, ""))
        if dev:
            return f"device:{dev['id']}"
    if hmac.compare_digest(token, ANY_CONSOLE_TOKEN):
        return token
    return None


def verify_ws_token(
    token: str,
    client_host: str = "",
    headers: Mapping[str, str] | None = None,
    cookies: Mapping[str, str] | None = None,
) -> bool:
    return _authenticate(token, client_host, headers, cookies) is not None


def update_token(new_token: str) -> None:
    global ANY_CONSOLE_TOKEN
    save_json_file(_AUTH_FILE, {"token": new_token})
    ANY_CONSOLE_TOKEN = new_token


def ensure_default_token() -> str | None:
    """data/auth.json がなければ 32 文字のランダムトークンを生成・保存する。

    生成したトークンを返す。既にファイルが存在する場合は None を返す。
    認証の無効化判定は呼び出し元が行い、無効化時はこの関数を呼ばないこと。
    """
    if _AUTH_FILE.exists():
        return None
    token = secrets.token_urlsafe(24)  # 24 bytes → 32 base64url chars
    update_token(token)
    return token


def verify_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    client_host = (request.client.host or "") if request.client else ""
    identity = _authenticate(
        str(credentials.credentials) if credentials is not None else "",
        client_host,
        request.headers,
        request.cookies,
    )
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    return identity


def _extract_client_ip(request: Request) -> str:
    return request.client.host if request.client else ""
