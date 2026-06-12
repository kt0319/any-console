import { nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { usePrompt } from "./usePrompt.js";
import { emit } from "../app-bridge.js";
import { buildActionSummary } from "../utils/actionSummary.js";

const VALID_PANES = new Set([
  "history", "files", "changes", "branch", "jobs", "stash", "issues", "actions", "prs",
]);

export function useDeepLink() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { apiGet, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

  async function fetchBranchStatus(ws, branch, currentBranch) {
    if (branch === currentBranch) return "current";
    const { ok, data } = await apiGet(wsEndpoint(ws, "branches"));
    if (!ok || !Array.isArray(data)) return "unknown";
    return data.some((b) => b.name === branch) ? "exists" : "missing";
  }

  function buildDeepLinkMessage({ ws, worktree, branch, branchStatus, baseBranch, pane, session }) {
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

  async function resolveBranch(ws, branch, currentBranch, branchStatus, baseBranch) {
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
    const body = { branch: newName };
    if (baseBranch) body.base_branch = baseBranch;
    const res = await apiCommand(wsEndpoint(ws, "create-branch"), body, { errorMessage: "Failed to create branch" });
    if (!res.ok) return;
    emit("git:checkoutBranch", { branch: newName, remote: false });
  }

  async function attachSessionTab(sessionId) {
    const existing = terminalStore.openTabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      terminalStore.switchTab(existing.id);
      return true;
    }
    const { ok, data } = await apiGet("/terminal/sessions");
    if (!ok || !Array.isArray(data)) return false;
    const meta = data.find((s) => s.session_id === sessionId);
    if (!meta) return false;
    const tab = terminalStore.addTerminalTab({
      wsUrl: meta.ws_url,
      workspace: meta.workspace,
      wsIcon: meta.icon,
      wsIconColor: meta.icon_color,
      icon: meta.job_name ? (meta.icon || "mdi-play") : "mdi-console",
      iconColor: meta.icon_color,
      jobName: meta.job_name,
      jobLabel: meta.job_label,
      restored: true,
      hidden: false,
    });
    emit("tab:select", { tab });
    await nextTick();
    emit("layout:fitAll");
    setTimeout(() => emit("layout:fitAll"), 200);
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

    let found = null;
    if (effectiveWs) {
      found = workspaceStore.allWorkspaces.find((w) => w.name === effectiveWs);
      if (!found) return;
    }
    history.replaceState({}, "", location.pathname);

    const resolvedPane = pane && VALID_PANES.has(pane) ? pane : null;
    let branchStatus = null;
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
      const existingTab = terminalStore.openTabs.find((t) => t.workspace === effectiveWs && !t.hidden);
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

  return { apply };
}
