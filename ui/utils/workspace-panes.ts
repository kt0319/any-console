// ワークスペース詳細（WorkspaceDetail.vue）のペイン定義。ペインを追加する時はここだけを更新する
// （タブの見た目・件数は WorkspaceDetail.vue の tabs が持つ）。
// - requiresGit: 非 git ワークスペースで開こうとしたら files にフォールバックする
// - deepLinkable: ?pane= で直接開いてよい（dispatch/docker/select は push 通知等の経路で意図的に除外）
const WORKSPACE_PANES: Record<string, { requiresGit: boolean, deepLinkable: boolean }> = {
  files: { requiresGit: false, deepLinkable: true },
  history: { requiresGit: true, deepLinkable: true },
  changes: { requiresGit: true, deepLinkable: true },
  issues: { requiresGit: true, deepLinkable: true },
  actions: { requiresGit: true, deepLinkable: true },
  prs: { requiresGit: true, deepLinkable: true },
  docker: { requiresGit: false, deepLinkable: false },
  dispatch: { requiresGit: false, deepLinkable: false },
  select: { requiresGit: false, deepLinkable: false },
};

// 旧タブ名。branch/stash はそれぞれ History/Changes ペイン内のセクションに統合済み。
const PANE_ALIASES: Record<string, string> = {
  branch: "history",
  stash: "changes",
};

export const DEFAULT_PANE = "files";

/** 別名を解決した正当なペイン名。未知のキーは DEFAULT_PANE（どのペインにも一致せず本文が空になるのを防ぐ）。 */
export function resolvePaneKey(rawKey: string): string {
  const key = PANE_ALIASES[rawKey] ?? rawKey;
  return Object.hasOwn(WORKSPACE_PANES, key) ? key : DEFAULT_PANE;
}

export function paneRequiresGit(rawKey: string): boolean {
  const key = PANE_ALIASES[rawKey] ?? rawKey;
  return WORKSPACE_PANES[key]?.requiresGit ?? false;
}

export function isDeepLinkablePane(rawKey: string): boolean {
  const key = PANE_ALIASES[rawKey] ?? rawKey;
  return WORKSPACE_PANES[key]?.deepLinkable ?? false;
}

type PaneAvailabilityWorkspace = { is_git_repo?: boolean, github_url?: string | null, has_compose_file?: boolean };

// コマンドパレットから直接開けるペイン。表示条件は WorkspaceDetail.vue の tabs（hidden）と揃える
// （件数による出し分けだけは詳細を開かないと分からないため含めない）。
const PALETTE_PANES: { pane: string, label: string, icon: string, available: (ws: PaneAvailabilityWorkspace) => boolean }[] = [
  { pane: "files", label: "Files", icon: "mdi-folder-outline", available: () => true },
  { pane: "history", label: "History", icon: "mdi-source-branch", available: (ws) => !!ws.is_git_repo },
  { pane: "changes", label: "Changes", icon: "mdi-file-document-multiple-outline", available: (ws) => !!ws.is_git_repo },
  { pane: "issues", label: "Issues", icon: "mdi-ticket-confirmation-outline", available: (ws) => !!ws.is_git_repo && !!ws.github_url },
  { pane: "prs", label: "PRs", icon: "mdi-source-pull", available: (ws) => !!ws.is_git_repo && !!ws.github_url },
  { pane: "actions", label: "Actions", icon: "mdi-cog-play-outline", available: (ws) => !!ws.is_git_repo && !!ws.github_url },
  { pane: "docker", label: "Docker", icon: "mdi-docker", available: (ws) => !!ws.has_compose_file },
  { pane: "select", label: "Select & Copy", icon: "mdi-content-copy", available: () => true },
];

export function paletteWorkspacePanes(ws: PaneAvailabilityWorkspace) {
  return PALETTE_PANES.filter((p) => p.available(ws)).map(({ pane, label, icon }) => ({ pane, label, icon }));
}
