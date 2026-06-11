import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { usePrompt } from "./usePrompt.js";
import { emit } from "../app-bridge.js";

const VALID_PANES = new Set([
  "history", "files", "changes", "branch", "jobs", "stash", "issues", "actions", "prs",
]);

export function useDeepLink() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

  async function resolveBranch(ws, branch, currentBranch) {
    if (branch === currentBranch) return;

    const { ok, data } = await apiGet(wsEndpoint(ws, "branches"));
    const branches = ok && Array.isArray(data) ? data.map((b) => b.name) : [];
    const exists = branches.includes(branch);

    if (exists) {
      if (!await confirm(`Switch to branch "${branch}"?`)) return;
      emit("git:checkoutBranch", { branch, remote: false });
      return;
    }

    const newName = await prompt({
      title: "Create branch",
      message: `Branch "${branch}" does not exist. Create from current branch?`,
      initialValue: branch,
      placeholder: "branch name",
      confirmLabel: "Create",
    });
    if (!newName) return;
    const res = await apiCommand(wsEndpoint(ws, "create-branch"), { branch: newName }, { errorMessage: "Failed to create branch" });
    if (!res.ok) return;
    emit("git:checkoutBranch", { branch: newName, remote: false });
  }

  async function apply() {
    const params = new URLSearchParams(location.search);
    const ws = params.get("ws");
    const pane = params.get("pane");
    const branch = params.get("branch");

    if (!ws) return;

    const found = workspaceStore.allWorkspaces.find((w) => w.name === ws);
    if (!found) return;

    workspaceStore.selectedWorkspace = ws;
    history.replaceState({}, "", location.pathname);

    const resolvedPane = pane && VALID_PANES.has(pane) ? pane : null;
    if (resolvedPane) {
      emit("git:openFileModal", { pane: resolvedPane });
    }

    if (branch) {
      await resolveBranch(ws, branch, found.branch || "");
    }
  }

  return { apply };
}
