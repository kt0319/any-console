"""QRコードデバイスペアリング。

既に認証済みの端末から、新しいデバイスをQRコードスキャンだけでログインさせる
ためのエンドポイント群（`docs/DECISIONS.md` ADR27参照）。

- POST /auth/pairing/start         : 認証済みセッションのみ。短命・使い切りの
                                      ペアリングIDとトークンを発行する。
- GET  /auth/pairing/{id}/status   : 新デバイス・発行元の両方から未認証でポーリング可能。
- POST /auth/pairing/{id}/claim    : pairingToken を検証し、成功したら既存の
                                      device cookie 発行ロジック（devices.py /
                                      routers/devices.py）を再利用してログインを完了する。

セキュリティ:
- ペアリングエントリはプロセス内メモリのみに保持する（他の in-process state
  と同様、ADR1: 単一プロセス前提）。ディスクへは書かない。
- token は 24 バイトの url-safe ランダム値（推測不可能な入力）。claim 成功時に
  token を即座に破棄して claimed へ倒し、リプレイ（同一トークンの再利用）を防ぐ
  （発行元が成功を観測できるよう、エントリ自体は短いtombstone期間だけ残す）。
- id・token どちらも総当たりされないよう、専用のレートリミッタ（rate_limiter.py
  の `_FixedWindowCounter` を再利用）で start/status/claim を個別に絞る。
- claim は既存の単一トークン認証と同じ cookie 発行ロジックを共有する
  （二重実装しない）。QRペアリングは「同じユーザーの別デバイス追加」であり、
  新規ユーザー招待機能ではない（単一ユーザー前提は変えない）。
"""

import hmac
import logging
import secrets
import threading
import time

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import auth as auth_module
from ..auth import _resolve_tailscale_name, verify_token
from ..devices import autoname_from_user_agent, find_or_register_device
from ..errors import bad_request, gone, too_many_requests, unauthorized
from ..rate_limiter import _FixedWindowCounter
from .devices import _set_device_cookies

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/pairing")

PAIRING_TTL_SEC = 90

# claim成功後、token自体は即座に破棄しつつ「claimed」を発行元が観測できるよう
# エントリを少しだけ延命するtombstone期間。発行元は数秒間隔でstatusをポーリング
# しており、claimedを見た時点で即モーダルを閉じるため、この程度で十分。
_CLAIMED_TOMBSTONE_SEC = 10

# ポーリング（status）は countdown 表示のため数秒間隔で連打される想定なので緩め、
# start/claim は人間の単発操作なので厳しめにする。値の推測不可能性（24バイト）が
# 主防御で、これは連打・スクリプトによる荒らしを抑える二次防御。
_START_LIMIT = 20
_STATUS_LIMIT = 120
_CLAIM_LIMIT = 20
_RATE_WINDOW_SEC = 60

_lock = threading.Lock()
_pairings: dict[str, dict] = {}
_rate_counter = _FixedWindowCounter()


class ClaimBody(BaseModel):
    token: str = ""


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request, bucket: str, limit: int) -> None:
    key = f"pairing:{bucket}:{_client_ip(request)}"
    if not _rate_counter.is_allowed(key, limit, _RATE_WINDOW_SEC):
        raise too_many_requests("Too many requests")


def _sweep_expired_locked(now: float) -> None:
    expired = [pid for pid, p in _pairings.items() if p["expires_at"] <= now]
    for pid in expired:
        _pairings.pop(pid, None)


def _build_pairing_url(request: Request, pairing_id: str, pairing_token: str) -> str:
    hostname = _resolve_tailscale_name()
    if hostname:
        base = f"https://{hostname}"
    else:
        # tailscale未検出/未接続時は、同一LAN上での手動アクセス用にリクエスト
        # 自身の host:port へフォールバックする(schemeもリクエストに合わせる)。
        base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{base}/pair/{pairing_id}?t={pairing_token}"


@router.post("/start", dependencies=[Depends(verify_token)])
def start_pairing(request: Request):
    if not auth_module.ANY_CONSOLE_TOKEN:
        raise bad_request("Authentication is disabled")
    _check_rate_limit(request, "start", _START_LIMIT)
    now = time.time()
    pairing_id = f"pr_{secrets.token_hex(8)}"
    pairing_token = secrets.token_urlsafe(24)
    expires_at = now + PAIRING_TTL_SEC
    with _lock:
        _sweep_expired_locked(now)
        _pairings[pairing_id] = {
            "token": pairing_token,
            "expires_at": expires_at,
            "claimed": False,
        }
    url = _build_pairing_url(request, pairing_id, pairing_token)
    logger.info("pairing started id=%s client=%s", pairing_id, _client_ip(request))
    return {
        "id": pairing_id,
        "url": url,
        "expires_in_sec": PAIRING_TTL_SEC,
    }


@router.get("/{pairing_id}/status")
def pairing_status(pairing_id: str, request: Request):
    _check_rate_limit(request, "status", _STATUS_LIMIT)
    now = time.time()
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            return {"status": "not_found"}
        if entry["expires_at"] <= now:
            _pairings.pop(pairing_id, None)
            return {"status": "expired"}
        if entry["claimed"]:
            return {"status": "claimed"}
        return {"status": "pending", "expires_in_sec": max(0, int(entry["expires_at"] - now))}


@router.post("/{pairing_id}/claim")
def claim_pairing(pairing_id: str, body: ClaimBody, request: Request, response: Response):
    _check_rate_limit(request, "claim", _CLAIM_LIMIT)
    now = time.time()
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            raise gone("Pairing request not found or already used")
        if entry["claimed"] or entry["expires_at"] <= now:
            _pairings.pop(pairing_id, None)
            raise gone("Pairing request expired or already used")
        if not body.token or not hmac.compare_digest(body.token, entry["token"]):
            raise unauthorized("Invalid pairing token")
        # 使い切り: 認証成功が確定した時点で即座に claimed へ倒す（リプレイ防止）。
        # token自体はここで破棄し、以後の判定はclaimedフラグのみで行う。エントリは
        # 発行元がstatusでclaimedを観測できるよう短いtombstone期間だけ残す。
        entry["claimed"] = True
        entry["token"] = None
        entry["expires_at"] = now + _CLAIMED_TOMBSTONE_SEC

    ua = request.headers.get("user-agent", "")
    name = autoname_from_user_agent(ua)
    device_id, raw_secret = find_or_register_device(name, ua, source="pairing")
    _set_device_cookies(response, request, device_id, raw_secret)
    logger.info("pairing claimed id=%s device=%s client=%s", pairing_id, device_id, _client_ip(request))
    return {"ok": True, "device_id": device_id, "name": name, "auth_required": True}
