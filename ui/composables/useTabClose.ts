import { useConfirm } from "./useConfirm.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { emit } from "../app-bridge.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";

/**
 * タブ閉じ確認ダイアログと、その結果（close / "refresh" / "detach"）の
 * ディスパッチをまとめた共通フロー。
 *
 * 結果分岐を呼び出し側ごとにコピーすると、ダイアログの選択肢が増えた時に
 * 取りこぼす（サイドバーの閉じるボタンで Refresh / Detach の選択が黙って
 * 無視されていた回帰の再発防止）。close だけは呼び出し元でフォロー処理が
 * 異なるため `onClose` で差し替えられる（省略時は `tab:close` を emit）。
 */
export function useTabClose() {
  const { confirm } = useConfirm();
  const terminalStore = useTerminalStore();

  async function confirmAndCloseTab(
    tab: TerminalTab,
    onClose: (tab: TerminalTab) => void | Promise<void> = (t) => emit("tab:close", { tab: t }),
  ) {
    const result = await confirmCloseTab(confirm, tab);
    if (result === true) await onClose(tab);
    else if (result === "refresh") emit("tab:refresh", { tab });
    else if (result === "detach") terminalStore.detachTab(tab.id);
  }

  return { confirmAndCloseTab };
}
