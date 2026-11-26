import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTabClose } from "./useTabClose.ts";
import { emit } from "../app-bridge.ts";
import { copyTerminalSelection, isCopyShortcut } from "../utils/clipboard.ts";
import { isEditableTarget } from "../utils/dom.ts";

export function useGlobalShortcuts({ terminateTab }: { terminateTab: (tab: TerminalTab) => Promise<void> }) {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { confirmAndCloseTab } = useTabClose();

  async function onGlobalKeydown(e: KeyboardEvent) {
    // 入力フォーム上・設定画面表示中は標準のコピー動作を優先する。
    if (isCopyShortcut(e)) {
      const isFormField = isEditableTarget(e.target as HTMLElement);
      if (!isFormField && !layoutStore.isAnyOverlayOpen) {
        const tab = terminalStore.activeTab;
        if (copyTerminalSelection(tab?.term)) {
          e.preventDefault();
          return;
        }
      }
    }
    if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyW") {
      const tab = terminalStore.activeTab;
      if (!tab) return;
      e.preventDefault();
      // close のみ選択ワークスペースの同期が必要なため onClose で差し替える。
      await confirmAndCloseTab(tab, async (t) => {
        await terminateTab(t);
        const activeTab = terminalStore.activeTab;
        workspaceStore.selectedWorkspace = activeTab?.workspace || null;
      });
    } else if (e.code === "KeyN") {
      e.preventDefault();
      emit("workspace:openModal");
    } else if (e.code === "KeyT") {
      e.preventDefault();
      emit("terminal:launch", {});
    } else if (e.code === "KeyP") {
      e.preventDefault();
      emit("command-palette:open");
    } else if (e.code === "Period") {
      e.preventDefault();
      emit("settings:open");
    }
  }

  onMounted(() => {
    document.addEventListener("keydown", onGlobalKeydown, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("keydown", onGlobalKeydown, true);
  });
}
