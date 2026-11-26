import { nextTick, type Ref } from "vue";
import { useBusListener } from "./useBusListener.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import type { usePaneLoader } from "./usePaneLoader.ts";

/** WorkspaceDetail が購読する app-bridge イベント（git:* / worktree:open）のハンドラ。操作対象の状態は呼び出し側から受け取る。 */
export function useWorkspaceDetailEvents(deps: {
  open: (options: Record<string, any>) => void,
  switchPane: (key: string) => void,
  activePane: Ref<string>,
  clearDiffSelection: () => void,
  selectDiffFile: (detail: { path: string, isWorkingTree?: boolean, commitHash?: string }) => void,
  fileBrowser: Ref<{ navigateToPath: (path: string) => void } | null>,
  gitHistory: Ref<{ reload: () => void } | null>,
  paneLoader: ReturnType<typeof usePaneLoader>,
  updateViewTitle: () => void,
}) {
  const workspaceStore = useWorkspaceStore();

  useBusListener("git:openFileModal", (detail) => {
    deps.open(detail);
  });

  useBusListener("worktree:open", ({ name, pane } = {}) => {
    if (name) workspaceStore.selectedWorkspace = name;
    deps.open({ pane });
  });

  useBusListener("git:clearDiffSelection", () => {
    deps.clearDiffSelection();
  });

  useBusListener("git:selectDiffFile", (detail) => {
    deps.switchPane("files");
    deps.selectDiffFile(detail);
  });

  useBusListener("git:browseToFolder", ({ path }) => {
    deps.activePane.value = "files";
    deps.clearDiffSelection();
    // navigateToPath が読み込みを担うため、files ペインはロード済み扱いにする
    deps.paneLoader.markLoaded("files", workspaceStore.selectedWorkspace);
    deps.updateViewTitle();
    nextTick(() => deps.fileBrowser.value?.navigateToPath(path));
  });

  useBusListener("git:historyInvalidated", () => {
    if (deps.activePane.value === "history") {
      deps.gitHistory.value?.reload();
    } else {
      deps.paneLoader.invalidate("history");
    }
  });
}
