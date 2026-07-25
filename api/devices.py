"""Trusted Device 認証用の保存と検証ロジック。

新規登録時はトークンで本人確認し、デバイスごとに固有のシークレットを発行する。
クライアントは secret を HttpOnly cookie で保持し、以降の認証に使う。

セキュリティ:
- raw secret はクライアント側 cookie にしか存在しない。サーバには HMAC-SHA256
  ハッシュのみ保存する（漏洩しても元 secret は復元できない）。
- HMAC のキー (`data/server_key`) は初回起動時に生成し、0o600 で保護する。
  これが漏れると attacker は任意の secret を hash 化できるので注意する必要がある。
- デバイス単位で revoke 可能。トークン単一共有方式と違い、特定端末だけ無効化できる。
"""

import hashlib
import hmac
import logging
import secrets
import threading
import time

from .common import DATA_DIR, load_json_file, save_json_file

logger = logging.getLogger(__name__)

_DEVICES_FILE = DATA_DIR / "devices.json"
_SERVER_KEY_FILE = DATA_DIR / "server_key"
MAX_NAME_LEN = 80
MAX_UA_LEN = 200

# data/server_key が無い状態で複数スレッドが同時に _load_or_create_server_key
# を呼ぶと、全員が exists()==False を見て別々の鍵を生成し、最後の書き込みだけが
# 残る（他のスレッドが計算したハッシュは以後絶対に一致しなくなる）。check-then-act
# をロックで直列化し、鍵ファイルは常に1回だけ生成されるようにする。
_server_key_lock = threading.Lock()


def _load_or_create_server_key() -> bytes:
    with _server_key_lock:
        if _SERVER_KEY_FILE.exists():
            return _SERVER_KEY_FILE.read_bytes()
        _SERVER_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_bytes(32)
        _SERVER_KEY_FILE.write_bytes(key)
        try:
            _SERVER_KEY_FILE.chmod(0o600)
        except OSError:
            # Windows 等で chmod が効かない環境はそのまま続行
            pass
        return key


def _hash_secret(raw_secret: str) -> str:
    return hmac.new(_load_or_create_server_key(), raw_secret.encode("utf-8"), hashlib.sha256).hexdigest()


def _load() -> dict:
    data = load_json_file(
        _DEVICES_FILE, {"devices": []},
        validate=lambda d: isinstance(d, dict) and "devices" in d,
        log_label="devices.json",
    )
    return data if isinstance(data, dict) else {"devices": []}


def _save(data: dict) -> None:
    save_json_file(_DEVICES_FILE, data)


def autoname_from_user_agent(user_agent: str) -> str:
    """User-Agent から `Chrome on macOS` のような簡潔な名前を生成する。

    iOS の PWA（standalone）は UA に "Safari/" を含まず "Mobile/<build>" のみが残る
    ことがある。Android PWA も WebView 由来で識別が難しい。検出を順序立てて行う。
    """
    ua = (user_agent or "").strip()
    if not ua:
        return "Unknown device"
    # OS をまず判定する（PWA 判定で OS 情報を使うため）。
    # iPhone / iPad は UA に "Mac OS X" を含むので Mac 判定より先に評価する。
    os_name = "Unknown OS"
    for needle, name in [
        ("iPhone", "iOS"),
        ("iPad", "iPadOS"),
        ("Android", "Android"),
        ("Mac OS X", "macOS"),
        ("Macintosh", "macOS"),
        ("Windows NT", "Windows"),
        ("CrOS", "ChromeOS"),
        ("Linux", "Linux"),
    ]:
        if needle in ua:
            os_name = name
            break
    # ブラウザ判定。順序は重要（Edge は Chrome を含む、Chrome は Safari を含むなど）。
    browser = ""
    for needle, name in [
        ("Edg/", "Edge"),
        ("OPR/", "Opera"),
        ("Firefox/", "Firefox"),
        ("Chrome/", "Chrome"),
        ("Safari/", "Safari"),
    ]:
        if needle in ua:
            browser = name
            break
    # iOS の PWA は "Safari/" を含まず "Mobile/" だけ残るので Safari として扱う。
    if not browser and os_name in ("iOS", "iPadOS") and "Mobile/" in ua:
        browser = "Safari"
    # Android の WebView / PWA フォールバック。
    if not browser and os_name == "Android":
        browser = "Android Browser"
    if not browser:
        browser = "Browser"
    return f"{browser} on {os_name}"


def find_or_register_device(name: str, user_agent: str, source: str) -> tuple[str, str]:
    """同一UA・sourceのデバイスが既登録なら secret を再発行して返す。なければ新規登録。

    Tailscale 経由の自動登録で cookie が失われるたびに同一デバイスが増殖するのを防ぐ。
    最も直近に使われたエントリを再利用する（複数あった場合は last_seen_at が最新のもの）。
    """
    ua_stored = (user_agent or "")[:MAX_UA_LEN]
    data = _load()
    candidates = [
        d for d in data["devices"]
        if d.get("user_agent", "") == ua_stored and d.get("source", "token") == source
    ]
    if candidates:
        existing = max(candidates, key=lambda d: d["last_seen_at"])
        raw_secret = secrets.token_urlsafe(32)
        existing["secret_hash"] = _hash_secret(raw_secret)
        existing["last_seen_at"] = int(time.time())
        _save(data)
        logger.info("device reissued id=%s name=%s source=%s", existing["id"], existing["name"], source)
        return existing["id"], raw_secret
    return register_device(name, ua_stored, source=source)


def register_device(name: str, user_agent: str, source: str = "token") -> tuple[str, str]:
    """新デバイスを登録し (device_id, raw_secret) を返す。

    raw_secret はサーバには保存せず、戻り値経由でのみクライアントに渡す。
    source: 登録経路（"token" / "tailscale" / "legacy"）。UI 表示と運用判断用。
    """
    device_id = f"dev_{secrets.token_hex(8)}"
    raw_secret = secrets.token_urlsafe(32)
    now = int(time.time())
    data = _load()
    data["devices"].append({
        "id": device_id,
        "name": (name or "Unnamed device")[:MAX_NAME_LEN],
        "secret_hash": _hash_secret(raw_secret),
        "user_agent": (user_agent or "")[:MAX_UA_LEN],
        "source": source,
        "created_at": now,
        "last_seen_at": now,
    })
    _save(data)
    logger.info("device registered id=%s name=%s source=%s", device_id, name, source)
    return device_id, raw_secret


def verify_and_touch_device(device_id: str, raw_secret: str) -> dict | None:
    """device_id + raw_secret が登録済みデバイスと一致すれば dict を返す。

    一致した場合は last_seen_at を現在時刻に更新して保存する（副作用あり）。
    """
    if not device_id or not raw_secret:
        return None
    data = _load()
    expected_hash = _hash_secret(raw_secret)
    for dev in data["devices"]:
        if dev["id"] != device_id:
            continue
        if hmac.compare_digest(dev["secret_hash"], expected_hash):
            dev["last_seen_at"] = int(time.time())
            _save(data)
            result: dict = dev
            return result
    return None


def revoke_device(device_id: str) -> bool:
    if not device_id:
        return False
    data = _load()
    before = len(data["devices"])
    data["devices"] = [d for d in data["devices"] if d["id"] != device_id]
    if len(data["devices"]) == before:
        return False
    _save(data)
    logger.info("device revoked id=%s", device_id)
    return True


def list_devices() -> list[dict]:
    """secret_hash を除いた一覧を返す（UI 表示用）。"""
    return [
        {k: v for k, v in dev.items() if k != "secret_hash"}
        for dev in _load()["devices"]
    ]


def get_device(device_id: str) -> dict | None:
    if not device_id:
        return None
    for dev in _load()["devices"]:
        if dev["id"] == device_id:
            result: dict = {k: v for k, v in dev.items() if k != "secret_hash"}
            return result
    return None
