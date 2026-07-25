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
- token は 24 バイトの url-safe ランダム値（推測不可能な入力）。claim 成功時に
  token を即座に破棄して claimed へ倒し、リプレイ（同一トークンの再利用）を防ぐ。
  デバイス登録が完了して初めて claimed へ倒すため（下記 claim_pairing 参照）、
  途中で登録が失敗しても「claimed だがログインは失敗」という不整合を残さない。
  登録中もエントリ自体は dict に残す（`claiming` フラグで二重claimだけ排他する）
  — 一時的にでも dict から消すと、その間の status ポーリングが not_found を
  返し、発行元が「期限切れ」と誤認してポーリングを止めてしまうため。
- id・token どちらも総当たりされないよう、専用のレートリミッタ（rate_limiter.py
  の `_FixedWindowCounter` を再利用）で start/status/claim を個別に絞る。
  status・claim はどちらも実在する pairing_id ごとに独立してカウントする
  （Tailscale Serve 経由だと全クライアントが loopback 発に見えるため、IPだけで
  絞ると無関係な pairing_id への荒らしで正規の pairing まで巻き添えでブロック
  されてしまう）。実在しない pairing_id は共有バケットにまとめ（`_bounded_pairing_scope`。
  存在確認より前に呼ぶ都合上、そうしないと攻撃者が架空のIDを大量生成して
  キー空間を際限なく肥大化させられてしまう）、実在する pairing_id 用のキーは
  そのpairingがdictから消える時点で明示的に掃除する（`_evict_rate_limit_keys_for`。
  `_FixedWindowCounter` はキーを自動失効しないため、掃除しないと正規の
  pairingが完了・失効するたびにキーが永久に残り、長期稼働するプロセスで
  ゆっくり肥大化し続けてしまう）。
- claim成功後のエントリ（tombstone）は claimed_at から独立した観測猶予
  （`_CLAIMED_OBSERVATION_SEC`）で寿命を判定する。元の90秒期限間際にclaimが
  成立したケースでも、発行元のポーリングが少し遅れただけでclaimedを
  expiredと誤報告しないようにするため（statusは claimed を expires_at より
  先にチェックする）。
- claim は既存の単一トークン認証と同じ cookie 発行ロジックを共有する
  （二重実装しない）。QRペアリングは「同じユーザーの別デバイス追加」であり、
  新規ユーザー招待機能ではない（単一ユーザー前提は変えない）。同一UA・sourceの
  既存デバイスを再利用する `find_or_register_device` は使わず、claim のたびに
  必ず新規デバイスとして登録する（同一UAの2台を続けてペアリングすると、
  再利用ロジックが後発デバイスのために先発デバイスのsecretを回転させ、
  先発デバイスが無言でログアウトされてしまうため）。
- QRに埋め込む URL の https://<hostname> は、Tailscale Serve が「何かしら」
  稼働しているだけでなく、実際にこのプロセスの待受ポートへ proxy している
  ことまで確認できた場合にのみ使う（`_tailscale_serve_frontend_port`）。
  同一tailnetホストで別サービス向けにServeが設定されているだけのケースを
  誤って信頼し、到達しないURLをQRに埋め込まないようにするため。Serveの
  HTTPSは443固定ではなく8443/10000もサポートされるため、443決め打ちにせず
  実際のfrontendポートをWebキーから取り出して使う。
- 発行元が `http://localhost:8888` のようなloopbackアドレスで any-console を
  開いている場合、そのままリクエストのnetlocをQRに使うと「スキャンした
  端末自身のlocalhost」を指してしまい絶対に繋がらない。この場合は
  MagicDNS名+実ポートへ差し替える（Serveは未確認でもtailnet越しに到達
  できる。schemeはリクエスト自身のものを保持する — native TLS運用で
  https://localhost経由の場合にhttpへ決め打ちすると繋がらないため）か、
  それも引けなければ明確なエラーで拒否する（`_is_loopback_host`）。
"""

import hmac
import ipaddress
import json
import logging
import secrets
import threading
import time

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import auth as auth_module
from ..auth import _resolve_tailscale_name, verify_token
from ..common import SYSTEM_CMD_TIMEOUT_SEC, run_subprocess_safe
from ..devices import autoname_from_user_agent, register_device
from ..errors import bad_request, gone, server_error, too_many_requests, unauthorized
from ..rate_limiter import _FixedWindowCounter
from .devices import _set_device_cookies

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/pairing")

PAIRING_TTL_SEC = 90

# claim成功の観測猶予。claimがちょうど元の90秒期限間際に成立した場合でも、
# 発行元のポーリングがバックグラウンドタブ等で少し遅延しただけで「claimedを
# 見損ねてexpired扱いになる」ことがないよう、claimed後は claimed_at からの
# 経過時間で独立に判定する（元のexpires_atがどれだけ残っていたかに関わらず
# 一定の観測猶予を必ず確保する）。
_CLAIMED_OBSERVATION_SEC = 30

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
# _rate_counter専用の別ロック。start/status/claimはsync defルートのため
# FastAPI/Starletteのスレッドプールで実行され、複数リクエストが本当に並行して
# _rate_counter に触れうる（_pairings用の`_lock`と違い、`_FixedWindowCounter`
# 自体はロックを持たない）。`_evict_rate_limit_keys_for`は`_lock`保持中に
# 呼ばれる箇所があるため、同じ`_lock`を使い回すと自己デッドロックする
# （非再入ロック）。そのため独立したロックにする。ロック順序は常に
# `_lock`→`_rate_lock`（逆順で取得する箇所は無い）。
_rate_lock = threading.Lock()


class ClaimBody(BaseModel):
    token: str = ""


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request, bucket: str, limit: int, *, scope: str = "") -> None:
    client_key = f"{_client_ip(request)}:{scope}" if scope else _client_ip(request)
    key = f"pairing:{bucket}:{client_key}"
    with _rate_lock:
        allowed = _rate_counter.is_allowed(key, limit, _RATE_WINDOW_SEC)
    if not allowed:
        raise too_many_requests("Too many requests")


def _bounded_pairing_scope(pairing_id: str) -> str:
    """status/claimのレート制限に使うスコープ文字列。

    status/claimはpairing存在確認より前に呼ぶ必要があるため、pairing_idを
    そのままスコープに使うと、攻撃者が実在しないIDを無限に生成して
    `_FixedWindowCounter`（期限切れキーを掃除しない）のキー空間を際限なく
    肥大化させられてしまう。実在するpairing_idにだけ専用バケットを与え
    （同時に存在するpairing数は個人ツールの利用規模では常に小さく、TTLで
    自然に掃除される）、存在しないIDへのアクセスは共有バケットへまとめる
    （このバケットのキー数はIPの数だけに収まり、pairing_id導入前と同等）。
    """
    with _lock:
        exists = pairing_id in _pairings
    return pairing_id if exists else "unknown"


def _is_expired_locked(entry: dict, now: float) -> bool:
    if entry["claimed"]:
        return bool(now - entry.get("claimed_at", 0) > _CLAIMED_OBSERVATION_SEC)
    if entry["claiming"]:
        # デバイス登録の結果(claimed成功 or claiming解除してpendingへ戻る)が
        # 確定するまでは期限切れ扱いにしない。ここで掃除してしまうと、
        # claim_pairing側が保持しているローカル変数(_pairingsから見て既に
        # detachedな同一dictオブジェクト)への以後の書き込みが誰からも
        # 観測できなくなり、登録が成功してもissuer側は永久にnot_found/expired
        # を見ることになる。
        return False
    return bool(entry["expires_at"] <= now)


def _evict_rate_limit_keys_for(pairing_id: str) -> None:
    """pairing_id を消費し終えたら、そのpairing_idにスコープされたレート
    リミットキー（`pairing:status:<ip>:<pairing_id>` 等）も一緒に消す。

    `_bounded_pairing_scope` は実在するpairing_idにだけ専用バケットを与えて
    攻撃者による無限のID生成を防いだが、それだけでは正規のpairingが
    完了・失効するたびにそのキーが`_rate_counter._counts`へ永久に残り続け、
    長期稼働するプロセスでゆっくり肥大化してしまう。pairingが消える時点で
    対応するキーも掃除し、生きているpairing数に比例するサイズへ抑える。

    `_rate_lock` で保護する: sync defルート（start/status/claim）はスレッド
    プールで実行されるため、他リクエストの `_check_rate_limit` が
    `_rate_counter._counts` を読み書き中にここで走査・削除すると
    "dictionary changed size during iteration" で500になりうる。
    """
    suffix = f":{pairing_id}"
    with _rate_lock:
        stale = [k for k in _rate_counter._counts if k.endswith(suffix)]
        for k in stale:
            _rate_counter._counts.pop(k, None)


def _sweep_expired_locked(now: float) -> None:
    expired = [pid for pid, p in _pairings.items() if _is_expired_locked(p, now)]
    for pid in expired:
        _pairings.pop(pid, None)
        _evict_rate_limit_keys_for(pid)


def _tailscale_serve_frontend_port(backend_port: int) -> int | None:
    """Tailscale Serveがこのプロセスの待受ポートへ実際にproxyしているか確認し、
    確認できればServeの公開(フロントエンド)ポートを返す。一致しなければNone。

    `tailscale serve status --json` の `Web` は `{"host:frontend_port": {...}}`
    という形で、値の `Handlers["/"].Proxy` が実際にproxyしているbackend先を示す。
    単に「TCP/Webキーが存在する」だけでは、同一tailnetホストで動く別サービス
    向けのServe設定を誤って信頼してしまう（その場合 https://<hostname> は
    any-console に届かない）ため、backend側のポート一致まで確認する。
    さらにTailscaleのServe HTTPSは443固定ではなく8443/10000も使えるため、
    frontend側のポートもkeyから取り出して返す（呼び出し側が443決め打ちで
    URLを組み立てると、8443/10000で稼働している場合に繋がらないQRになる）。
    システム情報カード用の簡易チェック（system._get_tailscale_serve_running、
    "何か動いているか"の表示用）とは別に、ペアリング専用でここまで確認する。
    """
    result = run_subprocess_safe(["tailscale", "serve", "status", "--json"], timeout=SYSTEM_CMD_TIMEOUT_SEC)
    if result is None or result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        return None
    web = data.get("Web") if isinstance(data, dict) else None
    if not isinstance(web, dict):
        return None
    needle = f":{backend_port}"
    for key, site in web.items():
        handlers = site.get("Handlers", {}) if isinstance(site, dict) else {}
        root = handlers.get("/", {}) if isinstance(handlers, dict) else {}
        proxy = root.get("Proxy", "") if isinstance(root, dict) else ""
        if not (isinstance(proxy, str) and proxy.endswith(needle)):
            continue
        _, _, frontend_port_str = str(key).rpartition(":")
        if frontend_port_str.isdigit():
            return int(frontend_port_str)
    return None


def _is_loopback_host(host: str) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _effective_port(request: Request) -> int | None:
    """リクエストの実ポートを返す。省略時ポート(URLに `:port` が無い)は
    scheme標準ポート(https→443 / http→80)を補って返す。

    `request.url.port` は URL に明示的にポートが書かれている時しか値を
    持たない。native TLS を443番で運用していて発行元が `https://localhost`
    （`:443` を省略）で開いた場合、`port` が None のままだと Serve 一致確認や
    loopbackフォールバックの両方が「ポート不明」として素通りしてしまい、
    実際には到達可能なのにペアリングを拒否してしまう。
    """
    if request.url.port is not None:
        return request.url.port
    if request.url.scheme == "https":
        return 443
    if request.url.scheme == "http":
        return 80
    return None


def _build_pairing_url(request: Request, pairing_id: str, pairing_token: str) -> str:
    # MagicDNS名が引けても、Tailscale Serveがこのプロセスの待受ポートへ実際に
    # proxyしているとは確認できない限り https://<hostname> 決め打ちにはしない
    # （直接LAN/tailnet IPへbindしている構成や、Serveが別サービス向けに設定
    # されている構成では、そこにアクセスしても any-console には届かない）。
    hostname = _resolve_tailscale_name()
    port = _effective_port(request)
    frontend_port = _tailscale_serve_frontend_port(port) if hostname and port else None
    if hostname and frontend_port is not None:
        # ServeのHTTPSは443固定ではない(8443/10000もサポートされる)ため、
        # 実際のfrontendポートを使う。443はデフォルトポートなので省略する。
        suffix = "" if frontend_port == 443 else f":{frontend_port}"
        return f"https://{hostname}{suffix}/pair/{pairing_id}?t={pairing_token}"

    # 発行元が起動時通知の http://localhost:8888 のようなloopbackアドレスで
    # 開いている場合、そのままリクエストのnetlocを使うとQRの宛先が
    # 「スキャンした端末自身のlocalhost」になってしまい絶対に繋がらない。
    if _is_loopback_host(request.url.hostname or ""):
        if hostname and port:
            # Serveは未確認だが、MagicDNS名+実ポートならtailnet越しに他端末
            # から到達できる。schemeはリクエスト自身のものをそのまま使う
            # (native TLS運用 — main.py の SSL_KEYFILE/SSL_CERTFILE — では
            # そのポートがTLSを要求するため、http に決め打ちすると繋がらない)。
            return f"{request.url.scheme}://{hostname}:{port}/pair/{pairing_id}?t={pairing_token}"
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
    _check_rate_limit(request, "start", _START_LIMIT)
    now = time.time()
    pairing_id = f"pr_{secrets.token_hex(8)}"
    pairing_token = secrets.token_urlsafe(24)
    with _lock:
        _sweep_expired_locked(now)
    # _build_pairing_url は tailscale サブプロセスを最大2回呼び（それぞれ
    # SYSTEM_CMD_TIMEOUT_SEC 秒でタイムアウト）、遅い環境では数秒かかりうる。
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
            "claiming": False,
        }
    logger.info("pairing started id=%s client=%s", pairing_id, _client_ip(request))
    return {
        "id": pairing_id,
        "url": url,
        "expires_in_sec": PAIRING_TTL_SEC,
    }


@router.get("/{pairing_id}/status")
def pairing_status(pairing_id: str, request: Request):
    # claimと同じ理由(モジュール docstring 参照)でpairing_idごとに独立してカウントする。
    _check_rate_limit(request, "status", _STATUS_LIMIT, scope=_bounded_pairing_scope(pairing_id))
    now = time.time()
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            return {"status": "not_found"}
        # claimed後は claimed_at からの独立した観測猶予で判定する(元の
        # expires_atで先に弾くと、期限間際にclaimが成立したケースで
        # claimedをexpiredと誤報告してしまうため、claimed判定を先に行う)。
        if entry["claimed"]:
            if _is_expired_locked(entry, now):
                _pairings.pop(pairing_id, None)
                _evict_rate_limit_keys_for(pairing_id)
                return {"status": "not_found"}
            return {"status": "claimed"}
        if entry["claiming"]:
            # 登録処理の結果が確定するまでは期限切れにしない(理由は
            # _is_expired_locked のコメント参照)。結果はclaim_pairing側で
            # 確定させる(claimed成功、またはclaiming解除してpendingへ戻る)。
            return {"status": "pending", "expires_in_sec": max(0, int(entry["expires_at"] - now))}
        if entry["expires_at"] <= now:
            _pairings.pop(pairing_id, None)
            _evict_rate_limit_keys_for(pairing_id)
            return {"status": "expired"}
        return {"status": "pending", "expires_in_sec": max(0, int(entry["expires_at"] - now))}


@router.post("/{pairing_id}/claim")
def claim_pairing(pairing_id: str, body: ClaimBody, request: Request, response: Response):
    # 荒らし対策はpairing_idごとに独立してカウントする(理由はモジュール docstring 参照)。
    _check_rate_limit(request, "claim", _CLAIM_LIMIT, scope=_bounded_pairing_scope(pairing_id))
    now = time.time()
    with _lock:
        entry = _pairings.get(pairing_id)
        if entry is None:
            raise gone("Pairing request not found or already used")
        if entry["claimed"] or entry["claiming"] or entry["expires_at"] <= now:
            if entry["expires_at"] <= now:
                _pairings.pop(pairing_id, None)
                _evict_rate_limit_keys_for(pairing_id)
            raise gone("Pairing request expired or already used")
        if not body.token or not hmac.compare_digest(body.token, entry["token"]):
            raise unauthorized("Invalid pairing token")
        # デバイス登録が終わるまで claiming フラグだけで同時claimを排他する。
        # エントリ自体は dict に残したまま（削除すると、その間の status ポーリング
        # が not_found を返し、発行元が「期限切れ」と誤認してポーリングを止めて
        # しまう）。claimed にはまだ倒さない — デバイス登録がここから先で失敗
        # する可能性があり、倒してしまうと「claimedなのにログインは失敗」という
        # 観測不可能な不整合を発行元に見せてしまうため。
        entry["claiming"] = True

    ua = request.headers.get("user-agent", "")
    name = autoname_from_user_agent(ua)
    try:
        # find_or_register_device ではなく必ず新規登録する: 同一UAの2台を続けて
        # ペアリングした場合、再利用ロジックは後発のために先発のsecretを回転させ、
        # 先発デバイスを無言でログアウトさせてしまうため(claimは常に人間の
        # 明示操作なので、tailscale自動登録のような再利用の必要が無い)。
        device_id, raw_secret = register_device(name, ua, source="pairing")
        _set_device_cookies(response, request, device_id, raw_secret)
    except OSError:
        # デバイス登録(devices.json への書き込み等)に失敗。tokenをまだ破棄して
        # いないので、claimingを解除して再試行可能にする(有効期限内なら同じ
        # QRのままもう一度claimできる)。
        with _lock:
            entry["claiming"] = False
        logger.warning("pairing claim failed to register device id=%s", pairing_id)
        raise server_error("Failed to complete pairing. Please try again.") from None

    with _lock:
        # 発行元がstatusでclaimedを観測できるよう、tombstoneとして残す。
        # expires_atは元のペアリング有効期限のまま縮めない — 発行元のポーリングが
        # バックグラウンドタブ等で数十秒遅延しても「claimedを見損ねてexpired
        # 扱いになる」ことがないようにするため(token自体は既に破棄済みなので
        # 延命してもリプレイのリスクは無い)。
        entry["claimed"] = True
        entry["claiming"] = False
        entry["token"] = None
        entry["claimed_at"] = time.time()
    logger.info("pairing claimed id=%s device=%s client=%s", pairing_id, device_id, _client_ip(request))
    return {"ok": True, "device_id": device_id, "name": name, "auth_required": True}
