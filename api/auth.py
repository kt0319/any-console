import hmac
import ipaddress
import logging
import os
import secrets
import threading
import time
from typing import Mapping, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .common import DATA_DIR, load_json_file, save_json_file

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

_AUTH_FILE = DATA_DIR / "auth.json"

COOKIE_DEVICE_ID = "any_console_device"  # noqa: S105
COOKIE_DEVICE_SECRET = "any_console_secret"  # noqa: S105

# スコープ付き API トークン（v1: "dispatch" のみ）。将来 GitHub Actions 等の外部連携
# から /dispatch を呼ぶ際、全 API を解錠するメイントークンをそのまま渡さないための
# 用途限定トークン（docs/DECISIONS.md ADR 参照）。
API_TOKEN_SCOPE_DISPATCH = "dispatch"  # noqa: S105
API_TOKEN_MAX_NAME_LEN = 80
# data/auth.json への書き込み（メイントークンの update_token、api_tokens の
# create/revoke/verify の last_used 更新）はいずれも load → 変更 → save の
# read-modify-write。save_json_file は1回の書き込み自体はアトミックだが、この
# 一連の手順自体は保護しないため、ロック無しだと例えば revoke と同時に別スレッドの
# verify が古いリストを読んで上書き保存し、失効済みトークンが復活したり、
# メイントークンのローテーションが API トークン操作に巻き戻されたりしうる。
# 同一ファイルへの全書き込みをこの1本のロックで直列化する
# （単一プロセス構成 = ADR 1 のため、プロセス内ロックのみで足りる）。
_auth_file_lock = threading.Lock()

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
ENV_TRUST_TAILSCALE = "ANY_CONSOLE_TRUST_TAILSCALE_AUTH"
# 100.64.0.0/10 は CGNAT 帯。Tailscale は tailnet 内の各端末にこの範囲を割り当てる。
# Tailscale Serve / Funnel 経由のリクエストは tailscaled が同ホスト loopback に
# プロキシするケースが多いため、loopback も信頼ソースに含める。
_TAILSCALE_CGNAT = ipaddress.ip_network("100.64.0.0/10")
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _load_auth_file() -> dict:
    data = load_json_file(_AUTH_FILE, {})
    return data if isinstance(data, dict) else {}


def _load_token_from_file() -> str:
    token = _load_auth_file().get("token", "")
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
        from .devices import verify_and_touch_device
        dev = verify_and_touch_device(cookies.get(COOKIE_DEVICE_ID, ""), cookies.get(COOKIE_DEVICE_SECRET, ""))
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
    # api_tokens 等の他フィールドを消さないよう、既存データへマージして書く
    # （丸ごと上書きすると発行済みの API トークンが消えてしまう）。
    # _auth_file_lock で直列化し、同時に走る api_tokens の書き込みと競合して
    # 互いの変更を巻き戻さないようにする。ANY_CONSOLE_TOKEN への代入もこの
    # クリティカルセクションの中で行う（with を抜けた後だと、2つの update_token
    # 呼び出しがロック解放後にプリエンプトされ、ディスクの完了順とメモリの代入順が
    # 食い違いうる — 例えば A→B の順でファイルへ書いても、A のロック解放後に B が
    # 先にメモリを書き換え、その後 A のメモリ代入が上書きしてしまうケース）。
    with _auth_file_lock:
        data = _load_auth_file()
        data["token"] = new_token
        save_json_file(_AUTH_FILE, data)
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


def _load_api_tokens() -> list[dict]:
    tokens = _load_auth_file().get("api_tokens")
    return tokens if isinstance(tokens, list) else []


def _save_api_tokens(tokens: list[dict]) -> None:
    data = _load_auth_file()
    data["api_tokens"] = tokens
    save_json_file(_AUTH_FILE, data)


def create_api_token(name: str, scope: str = API_TOKEN_SCOPE_DISPATCH) -> tuple[dict, str]:
    """新規スコープ付き API トークンを発行する。

    (secret_hash を除いたメタデータ dict, raw トークン) を返す。raw トークンは
    ここでしか取得できず、サーバには api/devices.py と同じ HMAC-SHA256 ハッシュ
    （data/server_key）のみを保存する。
    """
    from .devices import _hash_secret
    token_id = f"tok_{secrets.token_hex(8)}"
    raw_token = secrets.token_urlsafe(32)
    entry = {
        "id": token_id,
        "name": (name or "Unnamed token")[:API_TOKEN_MAX_NAME_LEN],
        "scope": scope,
        "secret_hash": _hash_secret(raw_token),
        "created_at": int(time.time()),
        "last_used": None,
    }
    with _auth_file_lock:
        tokens = _load_api_tokens()
        tokens.append(entry)
        _save_api_tokens(tokens)
    logger.info("api token created id=%s name=%s scope=%s", token_id, entry["name"], scope)
    return {k: v for k, v in entry.items() if k != "secret_hash"}, raw_token


def list_api_tokens() -> list[dict]:
    """secret_hash を除いた一覧を返す（UI 表示用）。"""
    return [{k: v for k, v in t.items() if k != "secret_hash"} for t in _load_api_tokens()]


def get_api_token(token_id: str) -> dict | None:
    if not token_id:
        return None
    for t in _load_api_tokens():
        if t.get("id") == token_id:
            return {k: v for k, v in t.items() if k != "secret_hash"}
    return None


def revoke_api_token(token_id: str) -> bool:
    if not token_id:
        return False
    with _auth_file_lock:
        tokens = _load_api_tokens()
        before = len(tokens)
        tokens = [t for t in tokens if t.get("id") != token_id]
        if len(tokens) == before:
            return False
        _save_api_tokens(tokens)
    logger.info("api token revoked id=%s", token_id)
    return True


def _verify_api_token(raw_token: str) -> dict | None:
    """raw_token がどれかの api_tokens エントリと一致すれば last_used を更新して返す
    （secret_hash を含む生の dict）。一致しなければ None。"""
    if not raw_token:
        return None
    from .devices import _hash_secret
    expected_hash = _hash_secret(raw_token)
    with _auth_file_lock:
        tokens = _load_api_tokens()
        for t in tokens:
            if hmac.compare_digest(t.get("secret_hash", ""), expected_hash):
                t["last_used"] = int(time.time())
                _save_api_tokens(tokens)
                return t
    return None


def verify_dispatch_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> tuple[str, bool]:
    """POST /dispatch 専用の認証依存関数。

    まず通常の認証（メイントークン / デバイス cookie / Tailscale ヘッダ）を試し、
    失敗したら supplied トークンを dispatch scope の API トークンとして照合する。

    戻り値は (auth_label, is_scoped_token)。
    - auth_label: activity ログ用の安全な識別子。生の Bearer 値（メイントークン
      そのもの）は絶対に含まない。
    - is_scoped_token: dispatch scope の API トークンで認証された場合のみ True。
      呼び出し側（POST /dispatch）はこれで direct:true を拒否するかどうかを
      判定する。

    SECURITY: 呼び出し側で auth_label の文字列プレフィックス（"tailscale:" /
    "device:" / "token:" 等）を見て「dispatch トークンかどうか」や「ログに安全か」
    を判定してはならない。メイントークンは Settings > Auth で任意の文字列に設定
    できるため、"token:..." のような値をメイントークンに設定した管理者が
    dispatch トークン扱いされてしまう（direct:true が誤って拒否される／生の
    メイントークンが activity ログへそのまま残る）実バグがあった。ここで
    ブランチ確定時点の情報から判定を確定させ、文字列推測を必要としない形で返す。

    この依存関数を使うのは POST /dispatch だけにすること。
    `/dispatch/{id}/decision`・ステータスストリーム WS・他の全 API は
    `verify_token`（メイントークンのみ）のままにする。dispatch トークンだけが
    漏れた場合に、それを使って自分が投げた dispatch を自己承認できてしまうため。
    """
    client_host = (request.client.host or "") if request.client else ""
    raw = str(credentials.credentials) if credentials is not None else ""
    identity = _authenticate(raw, client_host, request.headers, request.cookies)
    if identity is not None:
        if not identity:
            return "disabled", False
        if identity == raw:
            # メイントークンの Bearer 一致（_authenticate の `return token` 分岐）
            # だけが生の Bearer 値をそのまま identity として返す。他の分岐
            # （tailscale:<user> / device:<id>）は自前で構築した非秘匿の識別子
            # なのでこの等価判定には一致しない。
            return "main", False
        return identity, False
    token_entry = _verify_api_token(raw)
    if token_entry is not None and token_entry.get("scope") == API_TOKEN_SCOPE_DISPATCH:
        return f"token:{token_entry['id']}", True
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def _extract_client_ip(request: Request) -> str:
    return request.client.host if request.client else ""
