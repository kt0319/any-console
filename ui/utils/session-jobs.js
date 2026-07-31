// セッション復元時のジョブ定義（/jobs/workspaces）取得に関する純粋ロジック。

/**
 * allJobs が空のままジョブセッションを復元すると、タブのジョブアイコンが
 * mdi-play にフォールバックし、以後リロードまで直らない（tab.icon は焼き込み）。
 * レスポンス全体ではなく、セッションが参照するワークスペース単位でジョブ定義が
 * 空なら一時失敗とみなして再取得すべき（他ワークスペース分は届いているのに、
 * 特定ワークスペースだけ config 読み取りタイミングがずれて空になるケースがある）。
 *
 * @param {Record<string, any>} allJobs /jobs/workspaces の結果
 * @param {{job_name?: string|null, workspace?: string|null}[]} sessions 復元対象のセッション一覧
 * @returns {boolean}
 */
export function needsJobsRefetch(allJobs, sessions) {
  const jobs = allJobs || {};
  return (sessions || []).some((s) => {
    if (!s.job_name) return false;
    const wsJobs = s.workspace ? jobs[s.workspace] : null;
    return !wsJobs || Object.keys(wsJobs).length === 0;
  });
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
