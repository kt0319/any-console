// allJobs が空のまま復元するとタブのジョブアイコンが mdi-play に焼き込まれリロードまで直らない。
// 他ワークスペース分は届いても特定ワークスペースだけ空になることがあるため、ワークスペース単位で判定する。
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

export async function loadSessionsResponse(
  sessionsRes: any,
  { refetch }: { refetch: () => Promise<any> },
): Promise<any> {
  if (sessionsRes && sessionsRes.ok) return sessionsRes;
  return refetch();
}

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
    // session.icon は job 側のアイコンなので wsIcon へフォールバックさせない（乗っ取りバグになる）
    wsIcon: ws?.icon || null,
    wsIconColor: ws?.icon_color || null,
    icon: session.job_name ? (jobDef?.icon || "mdi-play") : "mdi-console",
    iconColor: jobDef?.icon_color || null,
    jobName: session.job_name || null,
    jobLabel: session.job_label || null,
  };
}

export function isJobDefResolved(
  session: { job_name?: string | null; workspace?: string | null },
  allJobs: Record<string, any>,
): boolean {
  if (!session.job_name) return true;
  return !!(session.workspace && allJobs?.[session.workspace]?.[session.job_name]);
}

// ジョブ定義が解決できなかった時だけキャッシュ済みアイコンを優先する。
// 正規に mdi-play なだけのケースを上書きしないよう、解決成否は built.icon から推測せず jobResolved で受ける。
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
