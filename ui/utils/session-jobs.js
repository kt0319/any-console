// セッション復元時のジョブ定義（/jobs/workspaces）取得に関する純粋ロジック。

/**
 * allJobs が空のままジョブセッションを復元すると、タブのジョブアイコンが
 * mdi-play にフォールバックし、以後リロードまで直らない（tab.icon は焼き込み）。
 * ジョブセッションが 1 つでもあるのに allJobs が空なら、一時失敗とみなして再取得すべき。
 *
 * @param {Record<string, any>} allJobs /jobs/workspaces の結果
 * @param {{job_name?: string|null}[]} sessions 復元対象のセッション一覧
 * @returns {boolean}
 */
export function needsJobsRefetch(allJobs, sessions) {
  const isEmpty = !allJobs || Object.keys(allJobs).length === 0;
  if (!isEmpty) return false;
  return (sessions || []).some((s) => !!s.job_name);
}

/**
 * ジョブ定義を取得する。一時失敗で空だった場合は 1 回だけ再取得する。
 * fetch / JSON パースは呼び出し側から注入し、この関数自体はストア非依存に保つ。
 *
 * @param {*} jobsRes 先行取得済みの /jobs/workspaces レスポンス（null 可）
 * @param {{job_name?: string|null}[]} sessions 復元対象のセッション一覧
 * @param {{ readJson: (res: *) => Promise<Record<string, any>>, refetch: () => Promise<*> }} deps
 * @returns {Promise<Record<string, any>>}
 */
export async function loadAllJobs(jobsRes, sessions, { readJson, refetch }) {
  const allJobs = await readJson(jobsRes);
  if (!needsJobsRefetch(allJobs, sessions)) return allJobs;
  const retryRes = await refetch();
  return readJson(retryRes);
}

/**
 * /terminal/sessions の一時失敗でタブが 0 件のまま「復元完了」になるのを防ぐ。
 * レスポンスが失敗（null / !ok）なら 1 回だけ再取得したレスポンスを返す。
 *
 * @param {*} sessionsRes 先行取得済みの /terminal/sessions レスポンス（null 可）
 * @param {{ refetch: () => Promise<*> }} deps
 * @returns {Promise<*>}
 */
export async function loadSessionsResponse(sessionsRes, { refetch }) {
  if (sessionsRes && sessionsRes.ok) return sessionsRes;
  return refetch();
}

/**
 * pendingClose のうち、サーバのセッション一覧にもう存在しない id を返す。
 * サーバから消えた時点で削除は完了しており、pendingClose を保持し続ける理由がない。
 * 例外等で clearPendingClose が漏れた場合の取り残しをここで自己回復させる
 * （残ると同期ポーリングがそのセッションのタブを再追加できなくなる）。
 *
 * @param {Iterable<string>} pendingIds pendingClose 中の sessionId
 * @param {Set<string>} serverSessionIds サーバが返した sessionId の集合
 * @returns {string[]}
 */
export function stalePendingCloseIds(pendingIds, serverSessionIds) {
  return [...(pendingIds || [])].filter((id) => !serverSessionIds.has(id));
}

/**
 * /terminal/sessions のセッション meta から addTerminalTab 用のパラメータを組み立てる。
 * 復元・dispatch 結果・ディープリンク・detached 復帰の全経路で共通に使い、アイコン解決の
 * 分岐（wsIcon をワークスペース設定から、ジョブアイコンをジョブ定義から）を一元化する。
 * 呼び出し側は返り値へ `restored` 等を足す。
 *
 * @param {{ ws_url: string, workspace?: string|null, icon?: string|null, icon_color?: string|null, job_name?: string|null, job_label?: string|null }} session
 * @param {{ workspaces?: Array<Record<string, any>>, allJobs?: Record<string, any> }} [ctx]
 */
export function buildSessionTabParams(session, { workspaces = [], allJobs = {} } = {}) {
  const ws = (workspaces || []).find((w) => w.name === session.workspace);
  const jobDef = session.job_name && session.workspace
    ? allJobs?.[session.workspace]?.[session.job_name]
    : null;
  return {
    wsUrl: session.ws_url,
    workspace: session.workspace || null,
    wsIcon: ws?.icon || session.icon || null,
    wsIconColor: ws?.icon_color || session.icon_color || null,
    icon: session.job_name ? (jobDef?.icon || "mdi-play") : "mdi-console",
    iconColor: jobDef?.icon_color || null,
    jobName: session.job_name || null,
    jobLabel: session.job_label || null,
  };
}
