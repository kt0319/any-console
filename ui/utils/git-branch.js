export function normalizeLocalBranches(data) {
  return (data || []).map((b) => ({
    name: b.name || b,
    current: !!b.current,
    isDefault: !!b.is_default,
    remote: false,
    ahead: Number(b.ahead) || 0,
    behind: Number(b.behind) || 0,
    upstream: b.upstream || null,
    gone: !!b.gone,
  }));
}

export function filterRemoteBranches(data, localBranches) {
  const localNames = new Set((localBranches || []).map((b) => b.name));
  return (data || [])
    .filter((b) => !localNames.has(b.name || b))
    .map((b) => ({ name: b.name || b, current: false, remote: true }));
}

export function buildWorktreeMap(worktrees) {
  const map = {};
  for (const wt of worktrees || []) {
    if (wt.branch) map[wt.branch] = wt;
  }
  return map;
}

export function canPull(branch) {
  return !branch.remote && !!branch.upstream && branch.behind > 0;
}

export function canPush(branch) {
  if (branch.remote) return false;
  if (!branch.upstream) return true;
  return branch.ahead > 0;
}
