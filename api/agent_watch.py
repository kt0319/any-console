"""ターミナルセッションのエージェント状態の監視・配信。

tmux の可視ペイン内容を定期ポーリングし、出力アクティビティから各セッションの
状態を判定して、変化のあったセッションだけ status stream の WebSocket 購読者へ
push する（routers/status_stream.py が git_watch と同じソケットに相乗せする）。

状態は 3 値（working / idle / blocked）。判定は 3 系統（優先度の高い順に
hooks > screen manifest > 画面差分）:

- agent hooks（設定したエージェントのみ・最優先）: エージェント自身の hooks が
  POST してきたイベント（api/agent_hooks.py）が新鮮な間はその状態を採用する。
  画面にもプロセスにも依存しない最も正確なソース。TTL 切れで下位へフォールバック。
- screen manifest（既知エージェントのみ）: エージェントを特定できたセッションは、
  herdr 由来のルール（screen_manifest.py）の判定（blocked / working / idle）を
  優先して採用する。スピナーの OSC タイトルで画面静止中の working を、
  プロンプトボックス検出でステータス行が動き続ける間の idle を正しく判定できる。
  ルール不一致・unknown・skip_state_update で確定しない場合は画面差分へ
  フォールバックする。特定はプロセス名（#{pane_current_command}）が一次で、
  当たらなければ前面ジョブの argv（api/foreground.py）でラッパー起動
  （node スクリプト・sh -c 等）も照合する。
- 画面差分（既定・フォールバック）: 前回ポーリングから出力が変化していれば
  working、静止で idle。素のシェル・未知ツールを含む全セッションに効く汎用判定。

加えて、素のターミナルに対する 2 つの自動紐付けを行う:

- **ワークスペース**: 未紐付けのセッションはペインの cwd（#{pane_current_path}）を
  登録済みワークスペースと最長前方一致で照合し、一致したら TMUX_WORKSPACE を
  刻印する（セッション復元時の detect_workspace_from_tmux と同じ判定をライブでも
  行い、`cd` しただけで Git ピル・activity 帰属が有効になる）。
- **ジョブ**: ジョブタグの無いセッションは前面ジョブの argv をジョブ定義と照合し、
  一致したらジョブメタデータ（TMUX_JOB_NAME 等）を自動で刻印する
  （api/job_match.py）。素のターミナルで手打ちされたジョブ相当のコマンドにも
  notify_phrase・アイコン表示など既存のジョブ機構が有効になる。

どちらも既存の紐付け（明示操作・復元時・過去の自動紐付け）は上書きしない。

ジョブ定義に notify_phrase が設定されている場合、可視ペインにその文字列が
現れたタイミングでプッシュ通知を送る（重複送信は抑制する）。ただし検出直後に
画面が動いた（ユーザーが反応した = 見ていた）場合は、PHRASE_NOTIFY_IDLE_GRACE_SEC
秒待っても通知しない。サーバー側に「今どのタブを見ているか」を伝える手段が無いため、
検出後のアクティビティ有無を「見ていたかどうか」の代用指標として使う。

タブの通知マーク（WS配信の phrase_notify）はこの猶予を待たない。クライアント側は
「今どのタブがアクティブか」を直接知っているため、対象タブを見ていれば即座に
消える。誤検知のコストが低いぶん、検出したポーリング周期で即時に一度だけ配信する。

git_watch と同じく購読者がいる間だけポーリングタスクが動き、購読者ゼロで
停止するため、クライアントが繋がっていないときのコストはゼロ。
"""

import asyncio
import logging
import time
from typing import Any

from fastapi import WebSocket

from .agent_hooks import hook_state
from .common import (
    AGENT_WATCH_POLL_INTERVAL_SEC,
    BACKGROUND_EXECUTOR,
    PHRASE_NOTIFY_IDLE_GRACE_SEC,
    TMUX_SESSION_PREFIX,
)
from .foreground import ForegroundInspector
from .job_match import JobPattern, build_job_patterns, candidate_jobs, match_job
from .screen_manifest import (
    ADOPTED_STATES,
    Manifest,
    evaluate_state,
    identify_agent,
    identify_agent_from_argvs,
)
from .tmux import _run_tmux_cmd, capture_visible_pane, list_pane_meta, load_tmux_metadata
from .ws_broadcast import SEND_ERRORS, broadcast_to

logger = logging.getLogger(__name__)

STATE_WORKING = "working"
STATE_IDLE = "idle"


def classify_agent_state(capture: str, prev_capture: str | None) -> str:
    """可視ペインの内容からセッション状態を判定する純関数。

    - 前回ポーリングから出力が変化していれば working（スピナー等の動きも拾う）
    - 画面が静止していれば idle
    """
    if prev_capture is not None and capture != prev_capture:
        return STATE_WORKING
    return STATE_IDLE


def resolve_session_state(
    capture: str, prev_capture: str | None, manifest: Manifest | None, pane_title: str,
) -> str:
    """画面差分と screen manifest を統合してセッション状態を決める。

    既知エージェント（manifest が特定済み）は manifest 判定
    （blocked / working / idle）を優先し、確定しない場合
    （ルール不一致・unknown・skip_state_update）は画面差分の結果を使う。
    """
    state = classify_agent_state(capture, prev_capture)
    if manifest is not None:
        manifest_state = evaluate_state(manifest, capture, osc_title=pane_title)
        if manifest_state in ADOPTED_STATES:
            state = manifest_state
    return state


def _detect_manifest(
    pane_command: str, pane_pid: int, inspector: ForegroundInspector,
) -> tuple[Manifest | None, list[list[str]] | None]:
    """エージェント特定。プロセス名で当たらなければ前面ジョブの argv で再照合する。

    Returns:
        (manifest, argvs): argvs はラッパー照合のために取得した場合のみ非 None
        （ジョブ照合で再利用し、前面ジョブ取得の二重実行を避ける）。
    """
    manifest = identify_agent(pane_command)
    argvs: list[list[str]] | None = None
    if manifest is None and pane_pid > 0:
        argvs = inspector.argvs(pane_pid)
        manifest = identify_agent_from_argvs(argvs)
    return manifest, argvs


def _apply_workspace_tag(session_id: str, workspace: str) -> None:
    """cwd 照合で判明したワークスペースをセッションへ刻印する。

    復元時の自動判定（detect_workspace_from_tmux）と同じ紐付けをライブの
    セッションにも適用する。刻印されれば Git ピル・activity 帰属・
    ワークスペースジョブの照合対象化が有効になる。
    """
    from .terminal_session import TERMINAL_SESSIONS, sessions_lock
    with sessions_lock:
        cached = TERMINAL_SESSIONS.get(session_id)
        if cached is not None:
            cached.workspace = workspace
    if cached is not None:
        cached.save_workspace()
    else:
        _run_tmux_cmd(
            "set-environment", "-t", TMUX_SESSION_PREFIX + session_id,
            "TMUX_WORKSPACE", workspace,
        )
    logger.info("auto-bound workspace session=%s workspace=%s", session_id, workspace)
    from .session_watch import notify_session_workspace_bound
    notify_session_workspace_bound(session_id, workspace)


def _resolve_workspace(session_id: str, workspace: str | None, pane_path: str) -> str | None:
    """未紐付けセッションを cwd の最長前方一致で自動紐付けする（ADR 32）。

    既に紐付いているセッションはそのまま返す（上書きしない）。
    """
    if workspace or not pane_path:
        return workspace
    from .config import match_workspace_by_path
    matched = match_workspace_by_path(pane_path)
    if matched is not None:
        _apply_workspace_tag(session_id, matched)
    return matched


def _apply_job_tag(session_id: str, pattern: JobPattern) -> None:
    """一致したジョブのメタデータをセッションへ刻印する。

    刻印されれば notify_phrase・アイコン表示など既存のジョブ機構が
    次のポーリング以降そのまま有効になる。
    """
    from .terminal_session import TERMINAL_SESSIONS, sessions_lock
    label = pattern.definition.label or pattern.name
    with sessions_lock:
        cached = TERMINAL_SESSIONS.get(session_id)
        if cached is not None:
            cached.job_name = pattern.name
            cached.job_label = label
            if not cached.icon and pattern.definition.icon:
                cached.icon = pattern.definition.icon
                cached.icon_color = pattern.definition.icon_color
    if cached is not None:
        cached.save_metadata()
    else:
        tmux_name = TMUX_SESSION_PREFIX + session_id
        _run_tmux_cmd(
            "set-environment", "-t", tmux_name, "TMUX_JOB_NAME", pattern.name,
            ";", "set-environment", "-t", tmux_name, "TMUX_JOB_LABEL", label,
        )
    logger.info("auto-tagged job session=%s job=%s", session_id, pattern.name)
    from .session_watch import notify_session_job_bound
    notify_session_job_bound(session_id, pattern.name, label)


def _maybe_autotag_job(
    session_id: str,
    workspace: str | None,
    job_name: str | None,
    pane_pid: int,
    argvs: list[list[str]] | None,
    inspector: ForegroundInspector,
) -> None:
    """未タグのセッションで前面ジョブがジョブ定義と一致したらタグ付けする。

    既にジョブタグのあるセッション（明示起動・過去の自動タグとも）は
    上書きしない。照合は完全一致のみ（api/job_match.py）。
    """
    if job_name or pane_pid <= 0:
        return
    if argvs is None:
        argvs = inspector.argvs(pane_pid)
    if not argvs:
        return
    pattern = match_job(argvs, build_job_patterns(candidate_jobs(workspace)))
    if pattern is not None:
        _apply_job_tag(session_id, pattern)


def _list_session_ids() -> list[str] | None:
    """tmux のセッション一覧を返す。tmux コマンド自体が失敗した場合は None。

    result.returncode != 0（tmux サーバー未起動でセッション0件など）と、
    result is None（コマンド実行自体の失敗・タイムアウト）を区別する。
    前者は正当な「セッション0件」なので [] を返すが、後者を [] にすると
    呼び出し元が一時的な取得失敗を「セッション消滅」と誤認してしまう。
    """
    result = _run_tmux_cmd("list-sessions", "-F", "#{session_name}")
    if result is None:
        return None
    if result.returncode != 0:
        return []
    ids = []
    for line in result.stdout.strip().splitlines():
        name = line.strip()
        if name.startswith(TMUX_SESSION_PREFIX) and len(name) > len(TMUX_SESSION_PREFIX):
            ids.append(name[len(TMUX_SESSION_PREFIX):])
    return ids


def _session_meta(session_id: str) -> tuple[str | None, str | None]:
    """セッションの (workspace, job_name) を返す。キャッシュ優先・tmux env で補完。"""
    from .terminal_session import TERMINAL_SESSIONS, sessions_lock
    with sessions_lock:
        cached = TERMINAL_SESSIONS.get(session_id)
    if cached is not None:
        return cached.workspace, cached.job_name
    meta = load_tmux_metadata(TMUX_SESSION_PREFIX + session_id)
    return meta.get("TMUX_WORKSPACE"), meta.get("TMUX_JOB_NAME")


def _job_notify_phrase(workspace: str | None, job_name: str | None) -> str:
    """セッションを起動したジョブ定義から notify_phrase を引く（ジョブ無しは空文字）。"""
    if not job_name:
        return ""
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        return entry[0].notify_phrase if entry else ""
    data = load_common_jobs_data()
    raw = data.get(job_name)
    return entry_to_job_definition(job_name, raw).notify_phrase if raw is not None else ""


# ポーリング間の可視ペイン内容（アクティビティ判定用）。ポーリングタスクのみが触る。
_last_capture: dict[str, str] = {}
# フレーズ初検出時刻（monotonic）。ここから PHRASE_NOTIFY_IDLE_GRACE_SEC 秒
# アクティビティが無ければ通知する。値が無い = 未検出 or 通知要否が確定済み。
_phrase_detected_at: dict[str, float] = {}
# 通知送信済み、または検出後の反応により通知不要と判定済みのセッション
# （フレーズが表示され続けている間の重複判定を抑制）。
_phrase_notified: set[str] = set()
# タブの通知マーク（WS配信）を送信済みのセッション。push と違い誤検知の
# コストが低い（見れば消える）ため、猶予を待たず検出即時に一度だけ送る。
_phrase_ws_notified: set[str] = set()

_subscribers: set[WebSocket] = set()
_poll_task: asyncio.Task | None = None
_last_states: dict[str, str] = {}


def reset_last_capture(session_id: str) -> None:
    """リサイズ後など、次回ポーリングで working を誤検知しないよう比較基準をクリアする。

    _last_states の stale な "working" も除去する。status stream WS が再接続時に
    スナップショットを送る際に古い "working" が届かないようにするため。
    """
    _last_capture.pop(session_id, None)
    if _last_states.get(session_id) == STATE_WORKING:
        _last_states.pop(session_id, None)


def _notify_grace_sec() -> int:
    """フレーズ検出からプッシュ通知までの猶予秒数（設定 > Notificationsで変更可能）。

    ポーリング周期ごとにセッション数分呼ばれる _should_notify_phrase 側では呼ばず、
    collect_agent_states の呼び出し1回につき1回だけ解決してから渡すこと
    （config読み込みのディスクI/Oをセッション数倍にしないため）。
    """
    from .config import load_global_config_section
    raw = load_global_config_section("notifications", {})
    if not isinstance(raw, dict):
        return PHRASE_NOTIFY_IDLE_GRACE_SEC
    value = raw.get("phrase_notify_grace_sec")
    if not isinstance(value, int) or value < 0:
        return PHRASE_NOTIFY_IDLE_GRACE_SEC
    return value


def _should_notify_phrase(
    session_id: str, notify_phrase: str, capture: str, changed: bool, now: float,
    grace_sec: int = PHRASE_NOTIFY_IDLE_GRACE_SEC,
) -> tuple[bool, bool]:
    """(should_push, should_clear_ws) を返す。
    should_push: notify_phrase 検出から grace_sec 秒アクティビティが
    無ければ True。should_clear_ws: 検出後にアクティビティがあり push を見送った瞬間に True
    （タブ通知マークを取り消すタイミングとしてそのまま使う。push と『見ていたとみなす』
    判定を共有するため、専用の状態は持たない）。
    _phrase_detected_at / _phrase_notified の更新（副作用）もここで行う。"""
    if not notify_phrase or notify_phrase not in capture:
        _phrase_detected_at.pop(session_id, None)
        _phrase_notified.discard(session_id)
        return False, False
    if session_id in _phrase_notified:
        return False, False
    if session_id not in _phrase_detected_at:
        # 初検出。フレーズ出現自体による変化は無視し、これ以降の変化だけを見る。
        _phrase_detected_at[session_id] = now
        return False, False
    if changed:
        # 検出後に画面が動いた = 見ていた とみなし、このフレーズ出現では通知しない。
        _phrase_detected_at.pop(session_id, None)
        _phrase_notified.add(session_id)
        return False, True
    if now - _phrase_detected_at[session_id] >= grace_sec:
        _phrase_notified.add(session_id)
        _phrase_detected_at.pop(session_id, None)
        return True, False
    return False, False


def _should_ws_notify_phrase(session_id: str, notify_phrase: str, capture: str) -> bool:
    """タブの通知マーク用の判定。push と違い「見ていたか」の推測猶予を待たず、
    検出したポーリング周期で即座に True を返す（見れば消える表示のため誤検知コストが低い）。
    フレーズが画面から消えたら次の出現でまた通知できるようリセットする。"""
    if not notify_phrase or notify_phrase not in capture:
        _phrase_ws_notified.discard(session_id)
        return False
    if session_id in _phrase_ws_notified:
        return False
    _phrase_ws_notified.add(session_id)
    return True


def collect_agent_states() -> tuple[
    dict[str, str] | None,
    list[tuple[str, str, str | None]],
    list[tuple[str, str, str | None]],
    list[str],
]:
    """全ターミナルセッションの状態を判定して返す（executor スレッドで実行）。

    Returns:
        (states, notifications, ws_notifications, ws_clear_session_ids): states は
        session_id→state の辞書。tmux コマンド自体が失敗した場合は states が None
        （呼び出し元は直前のスナップショットを保持し、空で上書きしない）。
        notifications はプッシュ通知すべき (session_id, phrase, workspace) のリスト
        （PHRASE_NOTIFY_IDLE_GRACE_SEC 秒の猶予あり）。
        ws_notifications はタブの通知マーク配信用の同形式のリスト（猶予なし・即時）。
        ws_clear_session_ids は、push を『見ていた』とみなして見送った session_id の
        リスト（タブ通知マークを出していれば同じ理由で取り消す）。
    """
    session_ids = _list_session_ids()
    if session_ids is None:
        return None, [], [], []
    states: dict[str, str] = {}
    notifications: list[tuple[str, str, str | None]] = []
    ws_notifications: list[tuple[str, str, str | None]] = []
    ws_clear_session_ids: list[str] = []
    now = time.monotonic()
    grace_sec = _notify_grace_sec()
    # manifest 判定・ジョブ照合用の (前面プロセス名, タイトル, シェル PID)。
    # 周期あたり tmux 1 回で全取得。前面ジョブの argv は必要になったときだけ
    # inspector 経由で取得する（macOS の ps は周期あたり最大 1 回に集約される）。
    pane_meta = list_pane_meta()
    inspector = ForegroundInspector()
    for session_id in session_ids:
        capture = capture_visible_pane(TMUX_SESSION_PREFIX + session_id)
        if capture is None:
            continue
        workspace, job_name = _session_meta(session_id)
        pane_command, pane_title, pane_pid, pane_path = pane_meta.get(
            TMUX_SESSION_PREFIX + session_id, ("", "", 0, ""))
        workspace = _resolve_workspace(session_id, workspace, pane_path)
        notify_phrase = _job_notify_phrase(workspace, job_name)
        prev_capture = _last_capture.get(session_id)
        # hooks 由来の状態が新鮮ならそれを最優先し、manifest 評価は省略する
        # （エージェント特定・argv 取得はジョブ照合が必要になれば遅延実行される）。
        argvs: list[list[str]] | None = None
        hooked = hook_state(session_id)
        if hooked is not None:
            new_state = hooked
        else:
            manifest, argvs = _detect_manifest(pane_command, pane_pid, inspector)
            new_state = resolve_session_state(capture, prev_capture, manifest, pane_title)
        states[session_id] = new_state
        _maybe_autotag_job(session_id, workspace, job_name, pane_pid, argvs, inspector)
        changed = prev_capture is not None and capture != prev_capture
        should_push, should_clear_ws = _should_notify_phrase(
            session_id, notify_phrase, capture, changed, now, grace_sec,
        )
        if should_push:
            notifications.append((session_id, notify_phrase, workspace))
        if should_clear_ws:
            ws_clear_session_ids.append(session_id)
        if _should_ws_notify_phrase(session_id, notify_phrase, capture):
            ws_notifications.append((session_id, notify_phrase, workspace))
        _last_capture[session_id] = capture
    for stale in set(_last_capture) - set(states):
        del _last_capture[stale]
    for stale in set(_phrase_detected_at) - set(states):
        del _phrase_detected_at[stale]
    _phrase_notified.intersection_update(states)
    _phrase_ws_notified.intersection_update(states)
    return states, notifications, ws_notifications, ws_clear_session_ids


def subscriber_count() -> int:
    return len(_subscribers)


def states_payload(states: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "agent_states",
        "states": [
            {"session_id": session_id, "state": state}
            for session_id, state in states.items()
        ],
    }


def phrase_notify_payload(session_id: str, phrase: str, workspace: str | None) -> dict[str, Any]:
    return {
        "type": "phrase_notify",
        "session_id": session_id,
        "phrase": phrase,
        "workspace": workspace,
    }


def phrase_notify_clear_payload(session_id: str) -> dict[str, Any]:
    return {
        "type": "phrase_notify_clear",
        "session_id": session_id,
    }


async def subscribe(websocket: WebSocket) -> None:
    """購読者を登録し、最初の購読者ならポーリングタスクを起動する。

    既知の状態スナップショットを即時送信して、再接続時にポーリング 1 周期分の
    空白が生まれないようにする。
    """
    _subscribers.add(websocket)
    _ensure_task()
    if _last_states:
        try:
            await websocket.send_json(states_payload(_last_states))
        except SEND_ERRORS:
            pass


def unsubscribe(websocket: WebSocket) -> None:
    """購読者を解除し、ゼロになったらポーリングを停止する。"""
    _subscribers.discard(websocket)
    if not _subscribers:
        _stop_task()


def _task_stale(task: asyncio.Task | None, loop: asyncio.AbstractEventLoop) -> bool:
    # テスト等でイベントループが作り直された場合、旧ループのタスクは無効
    return task is None or task.done() or task.get_loop() is not loop


def _ensure_task() -> None:
    global _poll_task
    loop = asyncio.get_running_loop()
    if _task_stale(_poll_task, loop):
        _poll_task = loop.create_task(_poll_loop())


def ensure_phrase_task() -> None:
    """push subscription が存在する場合にポーリングタスクを起動する。

    ブラウザが背景に行き WS 購読者がいなくても phrase 検出を継続するために呼ぶ。
    イベントループが動いていない場合（サーバ起動前など）は無視する。
    """
    global _poll_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _task_stale(_poll_task, loop):
        _poll_task = loop.create_task(_poll_loop())


def _stop_task() -> None:
    global _poll_task
    if _poll_task is not None and not _poll_task.done():
        try:
            _poll_task.cancel()
        except RuntimeError:  # 属するループが既に閉じている
            pass
    _poll_task = None
    _last_states.clear()
    _last_capture.clear()
    _phrase_detected_at.clear()
    _phrase_notified.clear()
    _phrase_ws_notified.clear()


def shutdown() -> None:
    """アプリ終了時のクリーンアップ（lifespan から呼ばれる）。"""
    _subscribers.clear()
    _stop_task()


def diff_states(previous: dict[str, str], current: dict[str, str]) -> dict[str, str]:
    """前回配信から状態が変わったセッションだけを取り出す純関数。"""
    return {
        session_id: state
        for session_id, state in current.items()
        if previous.get(session_id) != state
    }


async def _broadcast(payload: dict[str, Any]) -> None:
    await broadcast_to(_subscribers, payload, on_dead=unsubscribe)


async def _poll_loop() -> None:  # pragma: no cover - 実時間スリープに依存
    """購読者がいる間、または push subscription がある間、可視ペインをポーリングする。

    WS 購読者がいない場合でも push subscription が登録されていれば phrase 検出を継続し、
    バックグラウンド時の通知を可能にする。
    """
    from .push import has_subscriptions, send_push_notification
    try:
        while _subscribers or has_subscriptions():
            await asyncio.sleep(AGENT_WATCH_POLL_INTERVAL_SEC)
            if not _subscribers and not has_subscriptions():
                break
            loop = asyncio.get_running_loop()
            states, notifications, ws_notifications, ws_clear_session_ids = await loop.run_in_executor(
                BACKGROUND_EXECUTOR, collect_agent_states
            )
            if states is None:
                # tmux コマンド自体が一時的に失敗。直前のスナップショットを保持して
                # 次の周期に委ね、状態を空で上書きしない（誤って working/idle が消えるのを防ぐ）。
                continue
            changed = diff_states(_last_states, states)
            _last_states.clear()
            _last_states.update(states)
            if changed:
                await _broadcast(states_payload(changed))
            # タブの通知マークは見れば消える表示なので、push の猶予を待たず検出即時に配信する。
            for session_id, phrase, workspace in ws_notifications:
                await _broadcast(phrase_notify_payload(session_id, phrase, workspace))
            # push を『見ていた』とみなして見送った session は、出していたタブ通知マークも取り消す。
            for session_id in ws_clear_session_ids:
                await _broadcast(phrase_notify_clear_payload(session_id))
            for session_id, phrase, workspace in notifications:
                send_push_notification(
                    title="Phrase detected",
                    body=f"{workspace}: {phrase}" if workspace else phrase,
                    url=f"/?session={session_id}",
                    notif_type="phrase",
                )
    except asyncio.CancelledError:
        pass
