import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useConfirm } from "./useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { emit } from "../app-bridge.js";

export function useGlobalShortcuts({ closeTab }) {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const { confirm } = useConfirm();

  async function onGlobalKeydown(e) {
    // 選択中のターミナルがあれば Ctrl/Cmd+C をコピーに割り当てる（フォーカスが
    // 入力フォーム等にあるときは標準のコピー動作を優先するため対象外）。
    if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      const tag = /** @type {HTMLElement} */ (e.target)?.tagName;
      const isFormField = tag === "INPUT" || tag === "TEXTAREA" || /** @type {HTMLElement} */ (e.target)?.isContentEditable;
      if (!isFormField) {
        const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
        if (tab?.term?.hasSelection?.()) {
          const text = tab.term.getSelection();
          if (text && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          }
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
