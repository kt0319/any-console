import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const VALID_PANES = new Set([
  "history", "files", "changes", "branch", "jobs", "stash", "issues", "actions", "prs",
]);

export function useDeepLink() {
  const workspaceStore = useWorkspaceStore();

  function apply() {
    const params = new URLSearchParams(location.search);
    const ws = params.get("ws");
    const pane = params.get("pane");
    const branch = params.get("branch");

    if (!ws) return;

    const found = workspaceStore.allWorkspaces.find((w) => w.name === ws);
    if (!found) return;

    workspaceStore.selectedWorkspace = ws;

    if (branch) {
      emit("git:checkoutBranch", { branch, remote: false });
    }

    const resolvedPane = pane && VALID_PANES.has(pane) ? pane : null;
    if (resolvedPane) {
      emit("git:openFileModal", { pane: resolvedPane });
    }

    history.replaceState({}, "", location.pathname);
  }

  return { apply };
}
