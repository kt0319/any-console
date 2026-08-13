import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useConfirm } from "./useConfirm.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";
import { emit } from "../app-bridge.js";
import { copyTerminalSelection, isCopyShortcut } from "../utils/clipboard.ts";
import { isEditableTarget } from "../utils/dom.ts";

export function useGlobalShortcuts({ closeTab }: { closeTab: (tab: TerminalTab) => Promise<void> }) {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { confirm } = useConfirm();

  async function onGlobalKeydown(e: KeyboardEvent) {
    // 選択中のターミナルがあれば Ctrl/Cmd+C をコピーに割り当てる（フォーカスが
    // 入力フォーム等にあるとき、設定画面が開いているときは標準のコピー動作を優先するため対象外）。
    if (isCopyShortcut(e)) {
      const isFormField = isEditableTarget(e.target as HTMLElement);
      if (!isFormField && !layoutStore.isSettingsOpen) {
        const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
        if (copyTerminalSelection(tab?.term)) {
          e.preventDefault();
          return;
        }
      }
    }
    if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyW") {
      const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
      if (!tab) return;
      e.preventDefault();
      const result = await confirmCloseTab(confirm, tab);
      if (result === true) {
        await closeTab(tab);
        const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
        workspaceStore.selectedWorkspace = activeTab?.workspace || null;
      } else if (result === "refresh") {
        emit("tab:refresh", { tab });
      } else if (result === "detach") {
        terminalStore.detachTab(tab.id);
      }
    } else if (e.code === "KeyN") {
      e.preventDefault();
      emit("workspace:openModal");
    } else if (e.code === "KeyT") {
      e.preventDefault();
      emit("terminal:launch", {});
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
