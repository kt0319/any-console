// セッション復元時のジョブ定義（/jobs/workspaces）取得に関する純粋ロジック。

/**
 * allJobs が空のままジョブセッションを復元すると、タブのジョブアイコンが
 * mdi-play にフォールバックし、以後リロードまで直らない（tab.icon は焼き込み）。
 * レスポンス全体ではなく、セッションが参照するワークスペース単位でジョブ定義が
 * 空なら一時失敗とみなして再取得すべき（他ワークスペース分は届いているのに、
 * 特定ワークスペースだけ config 読み取りタイミングがずれて空になるケースがある）。
 *
 * @param allJobs /jobs/workspaces の結果
 * @param sessions 復元対象のセッション一覧
 */
export function needsJobsRefetch(
  allJobs: Record<string, any>,
  sessions: { job_name?: string | null; workspace?: string | null }[],
): boolean {
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
 * @param jobsRes 先行取得済みの /jobs/workspaces レスポンス（null 可）
 * @param sessions 復元対象のセッション一覧
 */
export async function loadAllJobs(
  jobsRes: any,
  sessions: { job_name?: string | null }[],
  { readJson, refetch }: {
    readJson: (res: any) => Promise<Record<string, any>>;
    refetch: () => Promise<any>;
  },
): Promise<Record<string, any>> {
  const allJobs = await readJson(jobsRes);
  if (!needsJobsRefetch(allJobs, sessions)) return allJobs;
  const retryRes = await refetch();
  return readJson(retryRes);
}

/**
 * /terminal/sessions の一時失敗でタブが 0 件のまま「復元完了」になるのを防ぐ。
 * レスポンスが失敗（null / !ok）なら 1 回だけ再取得したレスポンスを返す。
 *
 * @param sessionsRes 先行取得済みの /terminal/sessions レスポンス（null 可）
 */
export async function loadSessionsResponse(
  sessionsRes: any,
  { refetch }: { refetch: () => Promise<any> },
): Promise<any> {
  if (sessionsRes && sessionsRes.ok) return sessionsRes;
  return refetch();
}

/**
 * /terminal/sessions のセッション meta から addTerminalTab 用のパラメータを組み立てる。
 * 復元・dispatch 結果・ディープリンク・detached 復帰の全経路で共通に使い、アイコン解決の
 * 分岐（wsIcon をワークスペース設定から、ジョブアイコンをジョブ定義から）を一元化する。
 * 呼び出し側は返り値へ `restored` 等を足す。
 */
export function buildSessionTabParams(
  session: {
    ws_url: string;
    workspace?: string | null;
    icon?: string | null;
    icon_color?: string | null;
    job_name?: string | null;
    job_label?: string | null;
  },
  { workspaces = [], allJobs = {} }: {
    workspaces?: Array<Record<string, any>>;
    allJobs?: Record<string, any>;
  } = {},
) {
  const ws = (workspaces || []).find((w) => w.name === session.workspace);
  const jobDef = session.job_name && session.workspace
    ? allJobs?.[session.workspace]?.[session.job_name]
    : null;
  return {
    wsUrl: session.ws_url,
    workspace: session.workspace || null,
    // wsIconはワークスペース設定からのみ解決する（session.icon/icon_colorは
    // job側のアイコンで別概念のため、ここへフォールバックすると「ワークスペース
    // にアイコン未設定の時job側アイコンが乗っ取る」バグになる）。
    wsIcon: ws?.icon || null,
    wsIconColor: ws?.icon_color || null,
    icon: session.job_name ? (jobDef?.icon || "mdi-play") : "mdi-console",
    iconColor: jobDef?.icon_color || null,
    jobName: session.job_name || null,
    jobLabel: session.job_label || null,
  };
}

/**
 * session が参照するジョブ定義が allJobs 内に実在するかを返す。
 * jobDef.icon が未設定で "mdi-play" に落ちる場合と、ジョブ定義自体が見つからず
 * "mdi-play" にフォールバックする場合を区別するために使う（icon 文字列の比較だけでは
 * 「ジョブのアイコンが正規にデフォルトのまま」なのか「解決失敗」なのか判別できない）。
 */
export function isJobDefResolved(
  session: { job_name?: string | null; workspace?: string | null },
  allJobs: Record<string, any>,
): boolean {
  if (!session.job_name) return true;
  return !!(session.workspace && allJobs?.[session.workspace]?.[session.job_name]);
}

/**
 * サーバー応答の一時的な揺らぎで /terminal/sessions からセッションが消えてタブが
 * 削除→再生成された場合、ジョブ定義が実際に解決できなかった時に限り、以前に
 * 解決できたジョブアイコンがキャッシュにあればそちらを優先する。
 * ジョブ定義が解決できていて、その結果としてアイコンが正規にデフォルト
 * （mdi-play）なだけのケースまでキャッシュで上書きしないよう、解決成否は
 * jobResolved で明示的に渡す（built.icon 文字列からの推測はしない）。
 * 呼び出し側から Map を注入し、このモジュール自体はストア非依存に保つ。
 *
 * @param jobResolved isJobDefResolved の結果
 */
export function applyCachedJobIcon(
  built: ReturnType<typeof buildSessionTabParams>,
  jobResolved: boolean,
  session: { session_id: string; job_name?: string | null },
  cache: Map<string, { icon: string; iconColor: string | null }>,
) {
  if (!session.job_name) return built;
  const cached = cache.get(session.session_id);
  if (jobResolved || !cached) {
    cache.set(session.session_id, { icon: built.icon, iconColor: built.iconColor });
    return built;
  }
  return { ...built, icon: cached.icon, iconColor: cached.iconColor };
}
