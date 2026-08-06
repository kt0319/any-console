"""QRコードデバイスペアリング。

既に認証済みの端末から、新しいデバイスをQRコードスキャンだけでログインさせる
ためのエンドポイント群（`docs/DECISIONS.md` ADR28参照）。

- POST /auth/pairing/start         : 認証済みセッションのみ。短命・使い切りの
                                      ペアリングIDとトークンを発行する。
- GET  /auth/pairing/{id}/status   : 新デバイス・発行元の両方から未認証でポーリング可能。
- POST /auth/pairing/{id}/claim    : pairingToken を検証し、成功したら既存の
                                      device cookie 発行ロジック（devices.py /
                                      routers/devices.py）を再利用してログインを完了する。

セキュリティ:
- ペアリングエントリはプロセス内メモリのみに保持する（他の in-process state
  と同様、ADR1: 単一プロセス前提）。ディスクへは書かない。
- token は 24 バイトの url-safe ランダム値（推測不可能な入力）。claim は
  トークン検証・デバイス登録・cookie発行・claimedへの更新までを丸ごと
  `_lock` 保持下で行う（下記 claim_pairing 参照）。個人ツールの利用規模では
  デバイス登録（devices.json書き込み）にかかる時間は無視できるため、途中経過
  を表す中間状態を持たずに済む。これにより、同じtokenでの同時claimは後発が
  ロック待ちの後「既にclaimed」を見て自然に弾かれ、statusポーリングも
  claim完了前後どちらかの一貫した状態しか観測しない。
- id・token どちらも総当たりされないよう、専用のレートリミッタ（rate_limiter.py
  の `_FixedWindowCounter` を再利用）で start/status/claim 合算・IPごとに絞る。
  アプリ全体にかかる IP ベースの制限（rate_limiter.py の `RateLimitMiddleware`）
  に加えた二次防御であり、token の推測不可能性が主防御。3ルートを個別バケット
  に分けていた過去の実装は、この二次防御という位置づけに対して過剰だったため
  1バケットに統合している。
- claim成功後のエントリ（tombstone）は、claim成功時に `expires_at` を
  `_CLAIMED_OBSERVATION_SEC` 分だけ先に延長することで、一定の観測猶予を
  必ず確保する。元の90秒期限間際にclaimが成立し、発行元のポーリングが
  少し遅れた場合でも「claimedを見損ねてexpired扱いになる」ことを防ぐ
  （token自体は既に破棄済みなので延命してもリプレイのリスクは無い）。
- claim は既存の単一トークン認証と同じ cookie 発行ロジックを共有する
  （二重実装しない）。QRペアリングは「同じユーザーの別デバイス追加」であり、
  新規ユーザー招待機能ではない（単一ユーザー前提は変えない）。同一UA・sourceの
  既存デバイスを再利用する `find_or_register_device` は使わず、claim のたびに
  必ず新規デバイスとして登録する（同一UAの2台を続けてペアリングすると、
  再利用ロジックが後発デバイスのために先発デバイスのsecretを回転させ、
  先発デバイスが無言でログアウトされてしまうため）。
- QRに埋め込む URL は、Tailscale の MagicDNS 名が引ければ「ホスト名 + この
  プロセス自身の待受ポート」で組み立てる（Tailscale Serve の設定有無・
  proxy先の確認はしない — Serve が無くても tailnet 経由の直接アクセスで
  十分到達できるため、あえて複雑にしない）。ただし bind 自体がloopback専用
  （`__global__.host` が `127.0.0.1`/`::1`）の場合、MagicDNS名を使っても
  結局どこからも到達できないため使わない（`_bind_is_loopback_only`）。
  MagicDNS名が引けず、かつ発行元が `http://localhost:8888` のような
  loopbackアドレスで開いている場合は、そのままリクエストのnetlocを使うと
  QRの宛先が「スキャンした端末自身のlocalhost」になってしまい絶対に
  繋がらないため、明確なエラーで拒否する（`_is_loopback_host`）。
"""

import hmac
import ipaddress
import logging
import secrets
import threading
import time

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import auth as auth_module
from ..auth import _extract_client_ip as _client_ip
from ..auth import _resolve_tailscale_name, verify_token
from ..devices import autoname_from_user_agent, register_device
from ..errors import bad_request, gone, server_error, too_many_requests, unauthorized
from ..rate_limiter import _FixedWindowCounter
from .devices import _set_device_cookies

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/pairing")

PAIRING_TTL_SEC = 90

# claim成功の観測猶予。claim成功時にexpires_atをこの秒数だけ先に延長し、
# 発行元のポーリングがバックグラウンドタブ等で少し遅延しても「claimedを
# 見損ねてexpired扱いになる」ことがないようにする。
_CLAIMED_OBSERVATION_SEC = 30

# start/status/claim合算でIPごとに絞る。値の推測不可能性（24バイト）が主防御で、
# これは連打・スクリプトによる荒らしを抑える二次防御に過ぎないため、ルートごとに
# バケットを分ける必要はない。status は countdown 表示のため数秒間隔で連打される
# 想定を踏まえ、緩めの上限にする。
_PAIRING_RATE_LIMIT = 120
_RATE_WINDOW_SEC = 60

_lock = threading.Lock()
_pairings: dict[str, dict] = {}
_rate_counter = _FixedWindowCounter()
# _rate_counter専用の別ロック。start/status/claimはsync defルートのため
# FastAPI/Starletteのスレッドプールで実行され、複数リクエストが本当に並行して
# _rate_counter に触れうる（_pairings用の`_lock`と違い、`_FixedWindowCounter`
# 自体はロックを持たない）。
_rate_lock = threading.Lock()


class ClaimBody(BaseModel):
    token: str = ""


def _check_rate_limit(request: Request) -> None:
    key = f"pairing:{_client_ip(request)}"
    with _rate_lock:
        allowed = _rate_counter.is_allowed(key, _PAIRING_RATE_LIMIT, _RATE_WINDOW_SEC)
    if not allowed:
        raise too_many_requests("Too many requests")


def _is_expired_locked(entry: dict, now: float) -> bool:
    return bool(entry["expires_at"] <= now)


def _sweep_expired_locked(now: float) -> None:
    expired = [pid for pid, p in _pairings.items() if _is_expired_locked(p, now)]
    for pid in expired:
        _pairings.pop(pid, None)


def _is_loopback_host(host: str) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _bind_is_loopback_only() -> bool:
    """`__global__.host`(main.py の `_resolve_bind` が読む設定)がloopback専用
    かどうかを返す。circular import(main.pyがこのルータを登録している)を
    避けるため、`_is_loopback_host` と同様にconfigを直接読む。

    loopback専用bind(`127.0.0.1`/`::1`)の場合、tailnetの他端末はServeの
    有無に関わらずこのプロセスへ絶対に到達できない。発行元がlocalhost経由で
    開いていることだけを根拠にMagicDNS名へ差し替えると、そのMagicDNS名も
    結局loopbackにしか届かず無意味なQRになってしまうため、差し替え前に
    bind自体がloopback専用でないことも確認する。
    """
    from ..config import load_global_config_section

    host = load_global_config_section("host", "") or "0.0.0.0"  # noqa: S104 (デフォルト値の記述。bind自体はmain.pyが行う)
    return _is_loopback_host(str(host))


def _effective_port(request: Request) -> int | None:
    """リクエストの実ポートを返す。省略時ポート(URLに `:port` が無い)は
    scheme標準ポート(https→443 / http→80)を補って返す。

    `request.url.port` は URL に明示的にポートが書かれている時しか値を
    持たない。native TLS を443番で運用していて発行元が `https://localhost`
    （`:443` を省略）で開いた場合、`port` が None のままだと「ポート不明」
    として素通りしてしまい、実際には到達可能なのにペアリングを拒否してしまう。
    """
    if request.url.port is not None:
        # starlette の URL.port は型スタブ上 Any になる版があるため int に確定させる
        return int(request.url.port)
    if request.url.scheme == "https":
        return 443
    if request.url.scheme == "http":
        return 80
    return None


def _build_pairing_url(request: Request, pairing_id: str, pairing_token: str) -> str:
    # MagicDNS名が引ければ、このプロセス自身の待受ポートと組み合わせてtailnet
    # 越しに到達させる(Tailscale Serveの設定有無・proxy先の確認はしない —
    # Serveが無くてもtailnet経由の直接アクセスで到達できるため、あえて複雑に
    # しない。同一LANアクセスよりtailnet全体から届くこちらを優先する)。
    # ただしbind自体がloopback専用の場合は、MagicDNS名を使っても結局どこからも
    # 到達できないため使わない。
    hostname = _resolve_tailscale_name()
    port = _effective_port(request)
    if hostname and port and not _bind_is_loopback_only():
        return f"{request.url.scheme}://{hostname}:{port}/pair/{pairing_id}?t={pairing_token}"

    # MagicDNS名が引けない(またはbindがloopback専用)場合、発行元が起動時通知の
    # http://localhost:8888 のようなloopbackアドレスで開いていると、そのまま
    # リクエストのnetlocを使ってもQRの宛先が「スキャンした端末自身のlocalhost」
    # になってしまい絶対に繋がらない。
    if _is_loopback_host(request.url.hostname or ""):
        raise bad_request(
            "Cannot build a link reachable from another device while viewing "
            "any-console via localhost. Open it via its LAN or Tailscale address instead."
        )

    base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{base}/pair/{pairing_id}?t={pairing_token}"


@router.post("/start", dependencies=[Depends(verify_token)])
def start_pairing(request: Request):
    if not auth_module.ANY_CONSOLE_TOKEN:
        raise bad_request("Authentication is disabled")
    _check_rate_limit(request)
    now = time.time()
    pairing_id = f"pr_{secrets.token_hex(8)}"
    pairing_token = secrets.token_urlsafe(24)
    with _lock:
        _sweep_expired_locked(now)
    # _build_pairing_url は tailscale サブプロセスを呼ぶため
    # （SYSTEM_CMD_TIMEOUT_SEC 秒でタイムアウト）、遅い環境では数秒かかりうる。
    # expires_at をこの呼び出しより前に確定させると、レスポンスに乗せる
    # expires_in_sec（常にPAIRING_TTL_SEC固定）より先にバックエンドの寿命が
    # 進んでしまい、クライアントの表示するカウントダウンより早くexpiredに
    # なってしまう。URL確定後の時刻を起点にする。
    url = _build_pairing_url(request, pairing_id, pairing_token)
    expires_at = time.time() + PAIRING_TTL_SEC
    with _lock:
        _pairings[pairing_id] = {
            "token": pairing_token,
            "expires_at": expires_at,
            "claimed": False,
        }
    logger.info("pairing started id=%s client=%s", pairing_id, _client_ip(request))
    return {
        "id": pairing_id,
        "url": url,
        "expires_in_sec": PAIRING_TTL_SEC,
    }


@router.get("/{pairing_id}/status")
def pairing_status(pairing_id: str, request: Request):
    _check_rate_limit(request)
    now = time.time()
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            return {"status": "not_found"}
        if _is_expired_locked(entry, now):
            was_claimed = entry["claimed"]
            _pairings.pop(pairing_id, None)
            return {"status": "not_found" if was_claimed else "expired"}
        if entry["claimed"]:
            return {"status": "claimed"}
        return {"status": "pending", "expires_in_sec": max(0, int(entry["expires_at"] - now))}


@router.post("/{pairing_id}/claim")
def claim_pairing(pairing_id: str, body: ClaimBody, request: Request, response: Response):
    _check_rate_limit(request)
    now = time.time()
    # トークン検証からデバイス登録・cookie発行・claimedへの更新まで、
    # 丸ごと_lock保持下で行う。個人ツールの利用規模ではデバイス登録
    # (devices.json書き込み)にかかる時間は無視できるため、途中経過を表す
    # 中間状態を持たずに済む。同じtokenでの同時claimは後発がロック待ちの後
    # 「既にclaimed」を見て自然に弾かれ、statusポーリングもclaim完了前後
    # どちらかの一貫した状態しか観測しない。
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            raise gone("Pairing request not found or already used")
        if _is_expired_locked(entry, now):
            _pairings.pop(pairing_id, None)
            raise gone("Pairing request expired or already used")
        if entry["claimed"]:
            raise gone("Pairing request expired or already used")
        if not body.token or not hmac.compare_digest(body.token, entry["token"]):
            raise unauthorized("Invalid pairing token")

        ua = request.headers.get("user-agent", "")
        name = autoname_from_user_agent(ua)
        try:
            # find_or_register_device ではなく必ず新規登録する: 同一UAの2台を
            # 続けてペアリングした場合、再利用ロジックは後発のために先発の
            # secretを回転させ、先発デバイスを無言でログアウトさせてしまう
            # ため(claimは常に人間の明示操作なので、tailscale自動登録のような
            # 再利用の必要が無い)。
            device_id, raw_secret = register_device(name, ua, source="pairing")
            _set_device_cookies(response, request, device_id, raw_secret)
        except OSError:
            # デバイス登録(devices.json への書き込み等)に失敗。entryは
            # 一切変更していないので、token は有効なまま残り再試行できる。
            logger.warning("pairing claim failed to register device id=%s", pairing_id)
            raise server_error("Failed to complete pairing. Please try again.") from None

        # claimed後もtombstoneとしてエントリを残し、expires_atを観測猶予分
        # 延長する — 発行元のポーリングがバックグラウンドタブ等で数十秒
        # 遅延しても「claimedを見損ねてexpired扱いになる」ことがないように
        # するため(token自体は既に破棄済みなので延命してもリプレイの
        # リスクは無い)。
        entry["claimed"] = True
        entry["token"] = None
        entry["expires_at"] = now + _CLAIMED_OBSERVATION_SEC
    logger.info("pairing claimed id=%s device=%s client=%s", pairing_id, device_id, _client_ip(request))
    return {"ok": True, "device_id": device_id, "name": name, "auth_required": True}
