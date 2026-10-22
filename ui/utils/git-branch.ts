// セレクトボックスの先頭項目のように、現在ブランチを一覧の一番上に出す。
type RawBranch = {
  name?: string;
  current?: boolean;
  is_default?: boolean;
  ahead?: number | string;
  behind?: number | string;
  upstream?: string | null;
  gone?: boolean;
  tip?: string;
  merged?: boolean;
} | string;

export type LocalBranch = {
  name: string;
  current: boolean;
  isDefault: boolean;
  remote: boolean;
  ahead: number;
  behind: number;
  upstream: string | null;
  gone: boolean;
  tip: string;
  merged: boolean;
};

export type RemoteBranch = {
  name: string;
  current: boolean;
  remote: boolean;
};

type Worktree = {
  branch?: string;
  is_main?: boolean;
  [key: string]: unknown;
};

export function normalizeLocalBranches(data: RawBranch[] | null | undefined): LocalBranch[] {
  const mapped: LocalBranch[] = (data || []).map((b) => {
    const branch = typeof b === "string" ? { name: b } : b;
    return {
      name: branch.name || (typeof b === "string" ? b : ""),
      current: !!branch.current,
      isDefault: !!branch.is_default,
      remote: false,
      ahead: Number(branch.ahead) || 0,
      behind: Number(branch.behind) || 0,
      upstream: branch.upstream || null,
      gone: !!branch.gone,
      tip: branch.tip || "",
      merged: !!branch.merged,
    };
  });
  const current = mapped.find((b) => b.current);
  return current ? [current, ...mapped.filter((b) => !b.current)] : mapped;
}

export type MergedPull = { headRefName?: string, headRefOid?: string };

/**
 * サーバが祖先関係で判定できない squash / rebase マージ済みブランチを、マージ済み PR の
 * head コミットとブランチ先端の一致で補う（同名ブランチの再利用や、マージ後に積んだコミットは対象外）。
 */
export function markMergedBranches(branches: LocalBranch[], pulls: MergedPull[]): LocalBranch[] {
  if (pulls.length === 0) return branches;
  const mergedHeads = new Set(pulls.map((p) => `${p.headRefName}@${p.headRefOid}`));
  return branches.map((b) => {
    if (b.merged || b.current || b.isDefault || !b.tip) return b;
    return mergedHeads.has(`${b.name}@${b.tip}`) ? { ...b, merged: true } : b;
  });
}

export function filterRemoteBranches(data: RawBranch[] | null | undefined, localBranches: LocalBranch[] | null | undefined): RemoteBranch[] {
  const localNames = new Set((localBranches || []).map((b) => b.name));
  return (data || [])
    .filter((b) => !localNames.has(typeof b === "string" ? b : (b.name || "")))
    .map((b) => ({ name: (typeof b === "string" ? b : b.name) || "", current: false, remote: true }));
}

export function buildWorktreeMap(worktrees: Worktree[] | null | undefined): Record<string, Worktree> {
  const map: Record<string, Worktree> = {};
  for (const wt of worktrees || []) {
    if (wt.branch) map[wt.branch] = wt;
  }
  return map;
}

export function canPull(branch: LocalBranch | RemoteBranch) {
  return !branch.remote && !!(branch as LocalBranch).upstream && (branch as LocalBranch).behind > 0;
}

export function canPush(branch: LocalBranch | RemoteBranch) {
  if (branch.remote) return false;
  const local = branch as LocalBranch;
  if (!local.upstream) return true;
  return local.ahead > 0;
}
