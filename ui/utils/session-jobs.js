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
