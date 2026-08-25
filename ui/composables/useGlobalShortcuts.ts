import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTabClose } from "./useTabClose.ts";
import { emit } from "../app-bridge.ts";
import { copyTerminalSelection, isCopyShortcut } from "../utils/clipboard.ts";
import { isEditableTarget } from "../utils/dom.ts";

export function useGlobalShortcuts({ closeTab }: { closeTab: (tab: TerminalTab) => Promise<void> }) {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { confirmAndCloseTab } = useTabClose();

  async function onGlobalKeydown(e: KeyboardEvent) {
    // 選択中のターミナルがあれば Ctrl/Cmd+C をコピーに割り当てる（フォーカスが
    // 入力フォーム等にあるとき、設定画面が開いているときは標準のコピー動作を優先するため対象外）。
    if (isCopyShortcut(e)) {
      const isFormField = isEditableTarget(e.target as HTMLElement);
      if (!isFormField && !layoutStore.isSettingsOpen) {
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
      // close だけはショートカット固有のフォロー（選択ワークスペースの同期）が
      // あるため onClose で差し替える。refresh / detach は共通ディスパッチ。
      await confirmAndCloseTab(tab, async (t) => {
        await closeTab(t);
        const activeTab = terminalStore.activeTab;
        workspaceStore.selectedWorkspace = activeTab?.workspace || null;
      });
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
