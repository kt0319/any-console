"""Web Push 通知のコア処理。

VAPID キーの生成・保存・ロード、サブスクリプション管理、通知送信を担う。
秘密鍵は base64url エンコードした生バイト（32 bytes）で data/vapid_private.txt に保存する。
公開鍵（非圧縮 EC ポイント 65 bytes の base64url）は data/vapid_public.txt に保存する。
サブスクリプションは data/push_subscriptions.json に保存する。
"""

import base64
import json
import logging
import threading
from pathlib import Path

from .common import load_json_file, save_json_file

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_VAPID_PRIVATE_FILE = _DATA_DIR / "vapid_private.txt"
_VAPID_PUBLIC_FILE = _DATA_DIR / "vapid_public.txt"
_SUBSCRIPTIONS_FILE = _DATA_DIR / "push_subscriptions.json"
_VAPID_SUB_FILE = _DATA_DIR / "vapid_sub.txt"

_lock = threading.Lock()
_vapid_private_b64: str | None = None
_vapid_public_b64: str | None = None
_vapid_sub: str = "https://localhost"


def _generate_vapid_keys() -> tuple[str, str]:
    """秘密鍵を base64url、公開鍵を base64url で返す。

    cryptography は push 通知のための任意依存。未インストールの環境でも本体の起動を
    妨げないよう、鍵生成時にのみ遅延 import する（ImportError は呼び出し元が握る）。
    """
    from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    key = generate_private_key(SECP256R1())
    raw_priv = key.private_numbers().private_value.to_bytes(32, "big")  # type: ignore[attr-defined]
    private_b64 = base64.urlsafe_b64encode(raw_priv).rstrip(b"=").decode()
    raw_pub = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)  # type: ignore[arg-type]
    public_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()
    return private_b64, public_b64


def _load_or_create_vapid_keys() -> tuple[str, str]:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _VAPID_PRIVATE_FILE.exists() and _VAPID_PUBLIC_FILE.exists():
        return _VAPID_PRIVATE_FILE.read_text().strip(), _VAPID_PUBLIC_FILE.read_text().strip()
    private_b64, public_b64 = _generate_vapid_keys()
    _VAPID_PRIVATE_FILE.write_text(private_b64)
    _VAPID_PUBLIC_FILE.write_text(public_b64)
    logger.info("VAPID keys generated")
    return private_b64, public_b64


def set_vapid_sub(sub: str) -> None:
    """VAPID sub を更新してファイルに永続化する。"""
    global _vapid_sub
    with _lock:
        _vapid_sub = sub
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _VAPID_SUB_FILE.write_text(sub)
    logger.info("VAPID sub updated: %s", sub)


def init_vapid(sub: str | None = None) -> None:
    global _vapid_private_b64, _vapid_public_b64, _vapid_sub
    with _lock:
        try:
            _vapid_private_b64, _vapid_public_b64 = _load_or_create_vapid_keys()
        except ImportError:
            # cryptography 未インストール: push 通知は無効化し、本体は起動を続ける。
            logger.warning(
                "cryptography not installed; push notifications disabled "
                "(install cryptography and pywebpush to enable)"
            )
            return
        saved_sub = _VAPID_SUB_FILE.read_text().strip() if _VAPID_SUB_FILE.exists() else None
        if saved_sub:
            _vapid_sub = saved_sub
        elif sub:
            _vapid_sub = sub


def get_vapid_public_key() -> str | None:
    """VAPID 公開鍵を返す。push が利用不可（cryptography 未導入）なら None。"""
    if _vapid_public_b64 is None:
        init_vapid()
    return _vapid_public_b64


def _load_subscriptions() -> list[dict]:
    subs = load_json_file(_SUBSCRIPTIONS_FILE, [], validate=lambda d: isinstance(d, list))
    return subs if isinstance(subs, list) else []


def _save_subscriptions(subs: list[dict]) -> None:
    save_json_file(_SUBSCRIPTIONS_FILE, subs)


def has_subscriptions() -> bool:
    """push subscription が1件以上登録されているか返す。"""
    return len(_load_subscriptions()) > 0


def add_subscription(sub: dict) -> None:
    with _lock:
        subs = _load_subscriptions()
        endpoint = sub.get("endpoint")
        subs = [s for s in subs if s.get("endpoint") != endpoint]
        subs.append(sub)
        _save_subscriptions(subs)
    logger.info("push subscription added endpoint=%s", endpoint)
    from .agent_watch import ensure_phrase_task
    ensure_phrase_task()


def remove_subscription(endpoint: str) -> None:
    with _lock:
        subs = _load_subscriptions()
        subs = [s for s in subs if s.get("endpoint") != endpoint]
        _save_subscriptions(subs)
    logger.info("push subscription removed endpoint=%s", endpoint)


def send_push_notification(title: str, body: str, url: str = "/", notif_type: str = "") -> None:
    """全サブスクリプションへ Push 通知を同期送信する（ブロッキング）。失敗したサブスクリプションは削除する。"""
    if _vapid_private_b64 is None:
        init_vapid()
    if _vapid_private_b64 is None:
        # cryptography 未導入等で push が無効。サイレントにスキップする。
        return

    with _lock:
        subs = _load_subscriptions()

    if not subs:
        return

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush not installed, push notification skipped")
        return

    payload = json.dumps({"title": title, "body": body, "url": url, "type": notif_type})
    failed_endpoints: list[str] = []

    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=_vapid_private_b64,
                vapid_claims={"sub": _vapid_sub},
            )
        except WebPushException as e:
            resp = e.response
            status = (
                getattr(resp, "status_code", None)
                or getattr(resp, "status", None)
            ) if resp is not None else None
            logger.warning("push failed endpoint=%s status=%s detail=%s", sub.get("endpoint", ""), status, str(e))
            # 404/410 = 購読失効、400 VapidPkHashMismatch = 鍵不一致（永続的に無効）
            if status in (400, 404, 410):
                failed_endpoints.append(sub.get("endpoint", ""))
        except Exception as e:
            logger.warning("push error type=%s detail=%s", type(e).__name__, e)

    if failed_endpoints:
        with _lock:
            subs = _load_subscriptions()
            subs = [s for s in subs if s.get("endpoint") not in failed_endpoints]
            _save_subscriptions(subs)
