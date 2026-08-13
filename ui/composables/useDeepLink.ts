import { nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "./useConfirm.ts";
import { usePrompt } from "./usePrompt.ts";
import { emit } from "../app-bridge.ts";
import { buildActionSummary } from "../utils/actionSummary.ts";
import { buildSessionTabParamsWithCache } from "./useSessionSync.ts";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.ts";
import { DEEPLINK_REFIT_DELAY_MS } from "../utils/constants.ts";

const VALID_PANES = new Set([
  "history", "files", "changes", "branch", "jobs", "stash", "issues", "actions", "prs",
]);

export function useDeepLink() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { apiGet, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

  async function fetchBranchStatus(ws: string, branch: string, currentBranch: string) {
    if (branch === currentBranch) return "current";
    const { ok, data } = await getWithRetry(apiGet, wsEndpoint(ws, "branches"));
    if (!ok || !Array.isArray(data)) return "unknown";
    return data.some((b) => b.name === branch) ? "exists" : "missing";
  }

  function buildDeepLinkMessage({ ws, worktree, branch, branchStatus, baseBranch, pane, session }: {
    ws: string | null,
    worktree: string | null,
    branch: string | null,
    branchStatus: "current" | "exists" | "missing" | "unknown" | null,
    baseBranch: string | null,
    pane: string | null,
    session: string | null,
  }) {
    return buildActionSummary({
      title: "Open from URL?",
      workspace: ws,
      worktree,
      session,
      pane,
      branch,
      branchStatus,
      createBranch: true,
      baseBranch,
    });
  }

  async function resolveBranch(
    ws: string,
    branch: string,
    currentBranch: string,
    branchStatus: "current" | "exists" | "missing" | "unknown" | null,
    baseBranch: string | null,
  ) {
    if (branchStatus === "current") return;
    if (branchStatus === "exists") {
      emit("git:checkoutBranch", { branch, remote: false });
      return;
    }
    const base = baseBranch || currentBranch || "current branch";
    const newName = await prompt({
      title: "Create branch",
      message: `Create branch from "${base}":`,
      initialValue: branch,
      placeholder: "branch name",
      confirmLabel: "Create",
    });
    if (!newName) return;
    const body: { branch: string, base_branch?: string } = { branch: newName };
    if (baseBranch) body.base_branch = baseBranch;
    const res = await apiCommand(wsEndpoint(ws, "create-branch"), body, { errorMessage: "Failed to create branch" });
    if (!res.ok) return;
    emit("git:checkoutBranch", { branch: newName, remote: false });
  }

  async function attachSessionTab(sessionId: string) {
    const existing = terminalStore.openTabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      emit("tab:select", { tab: existing });
      return true;
    }
    const [sessionsRes, jobsRes] = await Promise.all([
      getWithRetry(apiGet, "/terminal/sessions"),
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
    ]);
    if (!sessionsRes.ok || !Array.isArray(sessionsRes.data)) return false;
    const meta = sessionsRes.data.find((s) => s.session_id === sessionId);
    if (!meta) return false;
    const allJobs = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
    const tab = terminalStore.addTerminalTab({
      ...buildSessionTabParamsWithCache(meta, { workspaces: workspaceStore.allWorkspaces, allJobs }),
      restored: true,
    });
    emit("tab:select", { tab });
    await nextTick();
    emit("layout:fitAll");
    setTimeout(() => emit("layout:fitAll"), DEEPLINK_REFIT_DELAY_MS);
    return true;
  }

  async function apply() {
    const params = new URLSearchParams(location.search);
    const ws = params.get("workspace") || params.get("ws");
    const worktree = params.get("worktree");
    const pane = params.get("pane");
    const branch = params.get("branch");
    const baseBranch = params.get("base_branch") || params.get("base");
    const session = params.get("session");
    const effectiveWs = ws && worktree ? `${ws} [${worktree}]` : ws;

    if (!effectiveWs && !session) return;

    let found: Record<string, any> | null | undefined = null;
    if (effectiveWs) {
      found = workspaceStore.allWorkspaces.find((w) => w.name === effectiveWs);
      if (!found) return;
    }
    history.replaceState({}, "", location.pathname);

    const resolvedPane = pane && VALID_PANES.has(pane) ? pane : null;
    let branchStatus: "current" | "exists" | "missing" | "unknown" | null = null;
    if (branch && effectiveWs && !worktree) {
      branchStatus = await fetchBranchStatus(effectiveWs, branch, found?.branch || "");
    }

    const message = buildDeepLinkMessage({
      ws,
      worktree,
      branch: worktree ? null : branch,
      branchStatus,
      baseBranch,
      pane: resolvedPane,
      session,
    });
    if (!await confirm(message, { ok: { label: "Open", icon: "mdi-open-in-new" } })) return;

    if (effectiveWs) workspaceStore.selectedWorkspace = effectiveWs;

    if (session) {
      const attached = await attachSessionTab(session);
      if (attached) return;
    }

    if (effectiveWs) {
      const existingTab = terminalStore.openTabs.find((t) => t.workspace === effectiveWs);
      if (existingTab) {
        terminalStore.switchTab(existingTab.id);
      }
    }

    if (resolvedPane) {
      emit("git:openFileModal", { pane: resolvedPane });
    }

    if (branch && effectiveWs && !worktree) {
      await resolveBranch(effectiveWs, branch, found?.branch || "", branchStatus, baseBranch);
    }
  }

  return { apply, attachSessionTab };
}
