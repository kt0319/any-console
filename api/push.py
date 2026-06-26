"""Web Push 通知のコア処理。

VAPID キーの生成・保存・ロード、サブスクリプション管理、通知送信を担う。
キーは data/vapid_private.pem / data/vapid_public.txt に保存する（初回自動生成）。
サブスクリプションは data/push_subscriptions.json に保存する。
"""

import base64
import json
import logging
import threading
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_VAPID_PRIVATE_FILE = _DATA_DIR / "vapid_private.pem"
_VAPID_PUBLIC_FILE = _DATA_DIR / "vapid_public.txt"
_SUBSCRIPTIONS_FILE = _DATA_DIR / "push_subscriptions.json"

_lock = threading.Lock()
_vapid_private_pem: str | None = None
_vapid_public_b64: str | None = None

VAPID_CLAIMS_SUB = "mailto:admin@localhost"


def _generate_vapid_keys() -> tuple[str, str]:
    key = generate_private_key(SECP256R1())
    private_pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()  # type: ignore[attr-defined]
    raw_pub = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)  # type: ignore[arg-type]
    public_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()
    return private_pem, public_b64


def _load_or_create_vapid_keys() -> tuple[str, str]:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _VAPID_PRIVATE_FILE.exists() and _VAPID_PUBLIC_FILE.exists():
        return _VAPID_PRIVATE_FILE.read_text(), _VAPID_PUBLIC_FILE.read_text().strip()
    private_pem, public_b64 = _generate_vapid_keys()
    _VAPID_PRIVATE_FILE.write_text(private_pem)
    _VAPID_PUBLIC_FILE.write_text(public_b64)
    logger.info("VAPID keys generated")
    return private_pem, public_b64


def init_vapid() -> None:
    global _vapid_private_pem, _vapid_public_b64
    with _lock:
        _vapid_private_pem, _vapid_public_b64 = _load_or_create_vapid_keys()


def get_vapid_public_key() -> str:
    if _vapid_public_b64 is None:
        init_vapid()
    return _vapid_public_b64  # type: ignore[return-value]


def _load_subscriptions() -> list[dict]:
    if not _SUBSCRIPTIONS_FILE.exists():
        return []
    try:
        data = json.loads(_SUBSCRIPTIONS_FILE.read_text())
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save_subscriptions(subs: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _SUBSCRIPTIONS_FILE.write_text(json.dumps(subs, indent=2))


def add_subscription(sub: dict) -> None:
    with _lock:
        subs = _load_subscriptions()
        endpoint = sub.get("endpoint")
        subs = [s for s in subs if s.get("endpoint") != endpoint]
        subs.append(sub)
        _save_subscriptions(subs)
    logger.info("push subscription added endpoint=%s", endpoint)


def remove_subscription(endpoint: str) -> None:
    with _lock:
        subs = _load_subscriptions()
        subs = [s for s in subs if s.get("endpoint") != endpoint]
        _save_subscriptions(subs)
    logger.info("push subscription removed endpoint=%s", endpoint)


def send_push_notification(title: str, body: str, url: str = "/") -> None:
    """全サブスクリプションへ Push 通知を非同期送信する。失敗したサブスクリプションは削除する。"""
    if _vapid_private_pem is None:
        init_vapid()

    with _lock:
        subs = _load_subscriptions()

    if not subs:
        return

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush not installed, push notification skipped")
        return

    payload = json.dumps({"title": title, "body": body, "url": url})
    failed_endpoints: list[str] = []

    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=_vapid_private_pem,
                vapid_claims={"sub": VAPID_CLAIMS_SUB},
            )
        except WebPushException as e:
            status = getattr(e.response, "status_code", None) if e.response else None
            logger.warning("push failed endpoint=%s status=%s", sub.get("endpoint", ""), status)
            # 410 Gone / 404 は購読失効
            if status in (404, 410):
                failed_endpoints.append(sub.get("endpoint", ""))
        except Exception as e:
            logger.warning("push error: %s", e)

    if failed_endpoints:
        with _lock:
            subs = _load_subscriptions()
            subs = [s for s in subs if s.get("endpoint") not in failed_endpoints]
            _save_subscriptions(subs)
