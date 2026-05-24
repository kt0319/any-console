import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useConfirm } from "./useConfirm.js";
import { emit } from "../app-bridge.js";

export function useGlobalShortcuts({ closeTab }) {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const { confirm } = useConfirm();

  async function onGlobalKeydown(e) {
    if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyW") {
      const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
      if (!tab) return;
      e.preventDefault();
      const label = tab.workspace || tab.label || "terminal";
      if (await confirm(`Close "${label}" tab?`)) {
        await closeTab(tab);
        const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
        workspaceStore.selectedWorkspace = activeTab?.workspace || null;
      }
    } else if (e.code === "KeyN") {
      e.preventDefault();
      emit("workspace:openModal");
    } else if (e.code === "KeyT") {
      e.preventDefault();
      emit("settings:open", { view: "TabConfig" });
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
