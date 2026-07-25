"""/dispatch エンドポイント。

外部から「workspace + job + テキスト」を1回のリクエストで投げて、
既存セッション再利用 or 新規作成、ブランチ確認/作成、起動コマンド実行、
text の tmux 送信までを行う。

既定（direct: false）では承認キューへ積んで即座に 202 を返し、実行は
Settings の Dispatch Queue からの承認（/dispatch/{id}/decision）だけが担う。
direct: true を明示した場合のみ承認を待たず即座に実行する。
キューの変化はステータスストリーム WS（type="dispatch_queue" の全量スナップ
ショット）で全購読端末へ配信する。

dedup_key を指定すると、同じキーの承認待ちが既にあればそれを置き換える
（CI の連続失敗などで同一要件のキュー項目が積み上がるのを防ぐ）。置き換え
時は retry_count を引き継いで +1 し、通知の重複送信は行わない。

POST /dispatch のみ verify_dispatch_token を使い、メイントークンに加えて
dispatch scope の API トークン（api/auth.py）も受け付ける。dispatch トークンは
キュー登録専用で direct: true を拒否する。/dispatch/{id}/decision・ステータス
ストリーム WS 等の他エンドポイントは引き続きメイントークンのみ
（dispatch トークン漏洩だけで自己承認できないようにするための境界）。
"""

import asyncio
import functools
import json
import logging
import secrets
import subprocess

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.responses import JSONResponse
from fastapi.websockets import WebSocketDisconnect
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_dispatch_token, verify_token
from ..common import (
    DISPATCH_QUEUE_FILE,
    resolve_workspace_path,
)
from ..errors import bad_request, server_error
from ..git_info import invalidate_git_info
from ..git_utils import (
    git_branch,
    git_branches,
    run_git_raw,
)
from ..job_models import TERMINAL_JOB, TERMINAL_JOB_KEY
from ..push import send_push_notification
from ..terminal_session import (
    TERMINAL_SESSIONS,
    create_registered_session,
    sessions_lock,
)
from ..tmux import (
    send_keys_to_tmux,
    tmux_session_exists,
    wait_pane_ready,
)
from ..validators import validate_branch_name
from .jobs_common import get_workspace_jobs

logger = logging.getLogger(__name__)

# NOTE: ルーター単位の共通 verify_token 依存はあえて使わない。POST /dispatch だけ
# dispatch scope の API トークンも受け付ける verify_dispatch_token を使うため、
# 各ルートで個別に依存を指定する（decision はメイントークンのみの verify_token）。
router = APIRouter()

# dispatch_id -> リクエスト payload（純データ。永続化ファイルと同型）
_PENDING: dict[str, dict] = {}
_subscribers: set[WebSocket] = set()
_broadcast_task: asyncio.Task | None = None
_broadcast_pending = False

# 読み取りが止まった購読者（サスペンド中のモバイル等）で送信バッファが詰まった
# 場合に、他の購読者への配信まで巻き込まれないための上限。超えたら切り離す。
BROADCAST_SEND_TIMEOUT_SEC = 5


def _queue_payload() -> dict:
    return {
        "type": "dispatch_queue",
        "items": [{"id": did, "request": req} for did, req in _PENDING.items()],
    }


async def subscribe(websocket: WebSocket) -> None:
    """ステータスストリーム WS の購読者を登録し、現在のキュー全量の配信を予約する。

    初回スナップショットもここで直送せず後続更新と同じ単一ワーカー経由で送る
    （直送すると、初回送信が backpressure で待たされている間にワーカーが新しい
    スナップショットを並行送信し、古い初回分が後から届いて stale が残るため）。
    全購読者への再送 1 回分のコストは、全量スナップショットが冪等なので無害。
    切断中に他端末で決定された項目が残らないよう、空でも必ず送る。
    """
    _subscribers.add(websocket)
    _schedule_queue_broadcast()


def unsubscribe(websocket: WebSocket) -> None:
    _subscribers.discard(websocket)


async def _broadcast_queue() -> None:
    """キューの現在の全量を全購読者へ push する。"""
    payload = _queue_payload()
    dead = []
    for ws in list(_subscribers):
        try:
            await asyncio.wait_for(ws.send_json(payload), timeout=BROADCAST_SEND_TIMEOUT_SEC)
        except TimeoutError:
            # タイムアウト＝半開きの可能性。dispatch 購読だけ黙って外すと、共有 WS が
            # OPEN のままのクライアントは再接続せず dispatch_queue だけ永続的に stale
            # になる。WS 自体を閉じ、クライアントの再接続（接続時の全量再同期）へ倒す。
            dead.append(ws)
            await _close_ws(ws)
        except (WebSocketDisconnect, RuntimeError, OSError):
            dead.append(ws)
    for ws in dead:
        unsubscribe(ws)


async def _close_ws(ws: WebSocket) -> None:
    try:
        await asyncio.wait_for(ws.close(), timeout=BROADCAST_SEND_TIMEOUT_SEC)
    except (WebSocketDisconnect, RuntimeError, OSError, TimeoutError):
        pass


def _schedule_queue_broadcast() -> None:
    """キュー配信をバックグラウンドの単一ワーカーで行う。

    購読者への send は読み取りが止まったクライアントでブロックしうるため、
    API ハンドラ内で await せず、レスポンス（/dispatch の即時 202・decision の
    実行結果）から切り離す。

    ワーカーは常に 1 本だけ走らせ、配信中に再スケジュールされたら完了後に
    最新状態でもう一度配信する（呼び出しごとに独立タスクを作ると、遅い購読者に
    足止めされた古いスナップショットが新しいものより後に届き、全量置き換えの
    クライアントで決定済み項目が復活しうるため。ペイロードは送信直前に計算する
    ので、この直列化により配信順は常に状態の新旧と一致する）。
    タスク参照は GC による中断を防ぐためモジュール変数に保持する。
    """
    global _broadcast_task, _broadcast_pending
    _broadcast_pending = True
    if _broadcast_task is None or _broadcast_task.done():
        _broadcast_task = asyncio.get_running_loop().create_task(_broadcast_worker())


async def _broadcast_worker() -> None:
    """dirty フラグが立っている限り、最新スナップショットの配信を繰り返す。
    配信中に積まれた複数回のスケジュールは 1 回の配信へ合流する。"""
    global _broadcast_pending
    while _broadcast_pending:
        _broadcast_pending = False
        await _broadcast_queue()


def _send_push_in_background(**kwargs) -> None:
    """push 送信をスレッドプールで行う。

    send_push_notification は全サブスクリプションへの同期送信（ブロッキング）
    のため、ハンドラ内で直接呼ぶと /dispatch の即時 202 が push エンドポイント
    の応答速度に引きずられ、イベントループも塞ぐ。
    """
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, functools.partial(send_push_notification, **kwargs))


def _persist_pending() -> None:
    """承認待ちリクエストを専用ファイルへ書き出す（サーバ再起動をまたいで残すため）。
    config.json とは分離する（あちらはエクスポート/インポート対象のユーザー設定のため）。"""
    tmp_path = DISPATCH_QUEUE_FILE.with_suffix(".tmp")
    try:
        tmp_path.write_text(json.dumps({"items": _PENDING}, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(DISPATCH_QUEUE_FILE)
    except OSError as e:
        logger.warning("dispatch queue persist failed: %s", e)


def _load_persisted_pending() -> None:
    if not DISPATCH_QUEUE_FILE.is_file():
        return
    try:
        raw = json.loads(DISPATCH_QUEUE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("dispatch queue read failed: %s", e)
        return
    items = raw.get("items") if isinstance(raw, dict) else None
    if not isinstance(items, dict):
        return
    for dispatch_id, request_payload in items.items():
        if isinstance(request_payload, dict):
            _PENDING[dispatch_id] = request_payload


class DispatchRequest(BaseModel):
    workspace: str
    worktree: str | None = None
    job: str = TERMINAL_JOB_KEY
    text: str = ""
    enter: bool = True
    match: str = "any"  # "any": workspace一致のみ / "job": workspace+job一致
    session_id: str | None = None  # 特定セッションを指定する場合に設定
    branch: str | None = None
    create_branch: bool = False
    base_branch: str | None = None
    direct: bool = False  # true: 承認を待たず即座に実行 / false（既定）: 承認キューへ積む
    dedup_key: str | None = None  # 同一キューの重複を束ねる。呼び出し元が意味を決める opaque な文字列

    @property
    def effective_workspace(self) -> str:
        return f"{self.workspace} [{self.worktree}]" if self.worktree else self.workspace


def _resolve_job_def(workspace: str, job: str):
    if job == TERMINAL_JOB_KEY:
        return TERMINAL_JOB
    available = get_workspace_jobs(workspace)
    entry = available.get(job)
    if not entry:
        raise bad_request(f"Unknown job: {job}")
    job_def, _ = entry
    return job_def


def _has_uncommitted_changes(ws_path) -> bool:
    try:
        result = run_git_raw(["status", "--porcelain"], ws_path)
    except (subprocess.TimeoutExpired, OSError) as e:
        raise server_error(f"Failed to check workspace status: {e}") from None
    return result.returncode == 0 and bool(result.stdout.strip())


def _ensure_branch(workspace_name: str, ws_path, branch: str, create: bool, base: str | None) -> None:
    branch = validate_branch_name(branch)
    current = git_branch(ws_path)
    if branch == current:
        return
    # checkout はブランチ切替時、未コミット変更があっても衝突しない限り黙って持ち越して
    # しまう。dispatch は外部起点の承認フローなので、意図しない混入を明示的に弾く。
    if _has_uncommitted_changes(ws_path):
        raise bad_request(
            f'Workspace has uncommitted changes. Commit or stash them before switching to "{branch}".'
        )
    branches = git_branches(ws_path)
    if branch in branches:
        args = ["checkout", branch]
    elif create:
        args = ["checkout", "-b", branch]
        if base:
            args.append(validate_branch_name(base))
    else:
        raise bad_request(f"Branch does not exist: {branch}")
    try:
        result = run_git_raw(args, ws_path)
    except (subprocess.TimeoutExpired, OSError) as e:
        raise server_error(f"Branch operation failed: {e}") from None
    if result.returncode != 0:
        raise bad_request(result.stderr.strip() or "Branch operation failed")
    # ステータスストリーム購読者へ FS イベントを待たずに即時反映する
    invalidate_git_info(workspace_name)


def _find_existing_session(workspace: str, job: str, match: str = "any"):
    if match == "none":
        return None, None
    target_job = None if job == TERMINAL_JOB_KEY else job
    with sessions_lock:
        for sid, sess in TERMINAL_SESSIONS.items():
            if sess.workspace != workspace:
                continue
            if sess.detached:
                continue
            if match == "job" and sess.job_name != target_job:
                continue
            if tmux_session_exists(sess.tmux_session_name):
                return sid, sess
    return None, None


def _create_session(workspace: str, ws_path, job: str, job_def):
    session_id, session = create_registered_session(
        ws_path,
        workspace=workspace,
        icon=job_def.icon,
        icon_color=job_def.icon_color,
        job_name=None if job == TERMINAL_JOB_KEY else job,
        job_label=job_def.label,
    )
    logger.info("dispatch session created session=%s workspace=%s job=%s",
                session_id, workspace, job)
    return session_id, session


class DispatchDecision(BaseModel):
    approved: bool
    # UI 確認時にユーザが書き換えた値を上書きとして受け取る。
    # 未指定（None）なら元の DispatchRequest 値をそのまま使う。
    workspace: str | None = None
    branch: str | None = None
    base_branch: str | None = None
    text: str | None = None
    job: str | None = None
    match: str | None = None
    create_branch: bool | None = None
    session_id: str | None = None


@router.post("/dispatch/{dispatch_id}/decision")
async def dispatch_decision(dispatch_id: str, body: DispatchDecision, _auth: str = Depends(verify_token)):
    """Settingsの「Dispatch Queue」からの承認/却下を受け取る。
    承認時はここで実行まで行い、起動結果をそのまま返す（/dispatch はキュー登録で
    即座に返るため、実行はこのエンドポイントだけが担う）。実行失敗時は項目を
    キューへ残し、値を修正しての再承認や却下をやり直せるようにする。"""
    payload = _PENDING.get(dispatch_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Pending dispatch not found")

    if not body.approved:
        log_activity(payload.get("workspace"), "dispatch_rejected")
        _PENDING.pop(dispatch_id, None)
        _persist_pending()
        _schedule_queue_broadcast()
        return {"status": "ok"}

    dispatch_body = DispatchRequest(**payload)
    _apply_overrides(dispatch_body, body.model_dump(exclude={"approved"}))
    try:
        result = _launch(dispatch_body)
    except HTTPException as e:
        # 失敗した項目はキューに残る（値を修正しての再承認・却下をやり直せる）
        log_activity(dispatch_body.workspace, "dispatch_failed", detail=str(e.detail))
        raise
    log_activity(
        result["workspace"], "dispatch_approved",
        job=result["job"], session_id=result["session_id"], created=result["created"],
    )
    _PENDING.pop(dispatch_id, None)
    _persist_pending()
    _schedule_queue_broadcast()
    return result


def _apply_overrides(body: DispatchRequest, overrides: dict | None) -> None:
    """承認モーダルで変更された値を DispatchRequest に反映する。None は無視。
    空文字は branch / base_branch を None にクリアし、text は空文字を設定する。"""
    if not overrides:
        return
    if "workspace" in overrides and overrides["workspace"]:
        body.workspace = overrides["workspace"]
        # ワークスペース選択は worktree を持たないベースワークスペースのみを
        # 対象にしているため、変更時は元リクエストの worktree を持ち越さない。
        body.worktree = None
    if "branch" in overrides and overrides["branch"] is not None:
        body.branch = overrides["branch"] or None
    if "base_branch" in overrides and overrides["base_branch"] is not None:
        body.base_branch = overrides["base_branch"] or None
    if "text" in overrides and overrides["text"] is not None:
        body.text = overrides["text"] or ""
    if "job" in overrides and overrides["job"] is not None:
        body.job = overrides["job"]
    if "match" in overrides and overrides["match"] is not None:
        body.match = overrides["match"]
    if "create_branch" in overrides and overrides["create_branch"] is not None:
        body.create_branch = overrides["create_branch"]
    if "session_id" in overrides and overrides["session_id"] is not None:
        body.session_id = overrides["session_id"]


def _resolve_session(body: DispatchRequest, effective_ws: str):
    """body.session_id → 既存セッション探索 の順でセッションを解決する。"""
    if body.session_id:
        with sessions_lock:
            session = TERMINAL_SESSIONS.get(body.session_id)
        if session and tmux_session_exists(session.tmux_session_name):
            return body.session_id, session
    return _find_existing_session(effective_ws, body.job, body.match)


def _resolve_and_launch_session(body: DispatchRequest, effective_ws: str, ws_path, job_def):
    """セッション解決・ブランチ操作・テキスト送信を行い (session_id, session, created) を返す。"""
    session_id, session = _resolve_session(body, effective_ws)

    if body.branch and not body.worktree:
        branch_ws = (session.workspace if session and session.workspace else None) or effective_ws
        _ensure_branch(branch_ws, resolve_workspace_path(branch_ws), body.branch, body.create_branch, body.base_branch)

    created = False
    if session is None:
        session_id, session = _create_session(effective_ws, ws_path, body.job, job_def)
        created = True
        wait_pane_ready(session.tmux_session_name)
        if job_def.command:
            if not send_keys_to_tmux(session.tmux_session_name, job_def.command, enter=True):
                logger.warning("dispatch job launch send-keys failed session=%s", session_id)
        if body.text:
            session.pending_text = body.text
            session.pending_enter = body.enter
    elif body.text:
        if not send_keys_to_tmux(session.tmux_session_name, body.text, enter=body.enter):
            logger.warning("dispatch text send-keys failed session=%s", session_id)

    return session_id, session, created


def _launch(body: DispatchRequest) -> dict:
    """セッション起動を実行し、レスポンス用のresult dictを返す。"""
    effective_ws = body.effective_workspace
    ws_path = resolve_workspace_path(effective_ws)
    job_def = _resolve_job_def(effective_ws, body.job)
    session_id, session, created = _resolve_and_launch_session(body, effective_ws, ws_path, job_def)
    return {
        "status": "ok",
        "session_id": session_id,
        "workspace": effective_ws,
        "job": body.job,
        "created": created,
        "url": f"/?workspace={effective_ws}&session={session_id}",
        "ws_url": f"/terminal/ws/{session_id}",
    }


def _find_pending_by_dedup_key(key: str) -> tuple[str, dict] | None:
    for did, req in _PENDING.items():
        if req.get("dedup_key") == key:
            return did, req
    return None


def _resolve_dedup(dispatch_id: str, dedup_key: str | None) -> tuple[str, int, bool]:
    """dedup_key が既存の承認待ちと一致するかを判定する（_PENDING を変更しない純粋な判定のみ）。

    戻り値: (使用すべき dispatch_id, retry_count, 初回通知を鳴らすべきか)。
    一致した場合、使用すべき dispatch_id は古い項目の ID を引き継ぐ（初回の push
    通知に埋め込んだ dispatchId を有効なまま保つため）。呼び出し側は retry_count > 1
    のとき、この dispatch_id で古い _PENDING エントリを pop してから新しい payload
    を書き込むこと。
    """
    if not dedup_key:
        return dispatch_id, 1, True
    superseded = _find_pending_by_dedup_key(dedup_key)
    if superseded is None:
        return dispatch_id, 1, True
    old_id, old_payload = superseded
    retry_count = old_payload.get("retry_count", 1) + 1
    return old_id, retry_count, retry_count == 1


def _branch_status(ws_path, branch: str) -> str:
    try:
        current = git_branch(ws_path)
        if branch == current:
            return "current"
        branches = git_branches(ws_path)
        return "exists" if branch in branches else "missing"
    except (OSError, ValueError):
        return "unknown"


@router.post("/dispatch")
async def dispatch(body: DispatchRequest, auth: tuple[str, bool] = Depends(verify_dispatch_token)):
    # auth_label は activity ログ用の安全な識別子（生のメイントークン値は含まない）、
    # is_scoped_token は dispatch scope の API トークンで認証された場合のみ True。
    # どちらも verify_dispatch_token が分岐確定時点で判定済みの値をそのまま使う
    # （identity の文字列プレフィックスをここで推測しない — メイントークンは任意の
    # 文字列に設定できるため、"token:" 等で始まる値だと誤判定するバグがあった）。
    auth_label, is_scoped_token = auth
    if body.direct and is_scoped_token:
        raise bad_request("Direct execution is not allowed for dispatch token")
    if is_scoped_token:
        # dispatch トークンは低信頼な外部連携（CI 等）用でキュー登録専用。session_id
        # をそのまま許すと、承認モーダルには _find_existing_session ベースの
        # 「New session」等が表示される一方、承認後の _resolve_session は
        # body.session_id を優先するため、攻撃者が知っている無関係な既存セッション
        # へ隠れてテキスト送信・ブランチ操作されてしまう（reviewer が見た内容と
        # 実行対象が乖離する）。dispatch トークンからのリクエストでは session_id を
        # 無視し、通常の workspace/job ベースの既存セッション探索だけに限定する。
        body.session_id = None
    effective_ws = body.effective_workspace
    ws_path = resolve_workspace_path(effective_ws)
    _resolve_job_def(effective_ws, body.job)  # 存在確認のみ（不正な job 名を早期に弾く）

    payload = body.model_dump()
    payload["effective_workspace"] = effective_ws
    if body.branch and not body.worktree:
        payload["branch_status"] = _branch_status(ws_path, body.branch)

    # 既存セッションがある場合、モーダルに実際のジョブと session_id を渡す。
    _pre_sid, _pre_sess = _find_existing_session(effective_ws, body.job, body.match)
    if _pre_sess is not None:
        payload["job"] = _pre_sess.job_name or TERMINAL_JOB_KEY
        payload["existing_session_id"] = _pre_sid

    dispatch_id = secrets.token_urlsafe(8)

    def _notify_push() -> None:
        _send_push_in_background(
            title="Dispatch",
            body=effective_ws,
            # 既存タブが無く新規ウィンドウが開く場合でも Dispatch Queue を開けるよう、
            # クエリで明示する（sw.js の postMessage は既存タブにしか届かない）。
            # dispatchId を付けて、通知から来た時にどのキュー項目か分かるようにする。
            url=f"/?openDispatchQueue=1&dispatchId={dispatch_id}",
            notif_type="dispatch",
        )

    if body.direct:
        _notify_push()
        result = _launch(body)
        log_activity(
            result["workspace"], "dispatch_executed",
            job=result["job"], session_id=result["session_id"], created=result["created"],
            auth=auth_label,
        )
        return result

    # dedup_key が既存の承認待ちと一致する場合、古い項目を新しい項目へ置き換える
    # （同一失敗の連続 dispatch でキューが積み上がるのを防ぐ）。retry_count はその
    # 引き継ぎ回数で、UI 側で「何度目の失敗か」を示すのに使う。
    dispatch_id, retry_count, should_notify = _resolve_dedup(dispatch_id, body.dedup_key)
    if retry_count > 1:
        _PENDING.pop(dispatch_id, None)
    payload["retry_count"] = retry_count

    # 置き換え時は既にキューに未対応の項目が待っている状態なので、通知を重ねて鳴らさない。
    if should_notify:
        _notify_push()

    log_activity(
        effective_ws, "dispatch_superseded" if retry_count > 1 else "dispatch_pending",
        job=body.job, text=body.text, auth=auth_label,
    )

    _PENDING[dispatch_id] = payload
    _persist_pending()
    _schedule_queue_broadcast()
    # 承認を待たずに返す。結果が必要な呼び出し元はセッションの出現（/terminal/sessions）
    # で確認するか、direct:true で即実行を使う。
    return JSONResponse(status_code=202, content={"status": "pending", "id": dispatch_id})
