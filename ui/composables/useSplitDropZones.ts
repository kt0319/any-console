import { useLayoutStore } from "../stores/layout.ts";
import { useSplitDropDrag } from "./useSplitDropDrag.ts";

/** ターミナル分割のドロップゾーン（HTML5 DnD）ハンドラ。drop の確定処理は applySplitDrop（useSplitDropDrag と共通）。 */
export function useSplitDropZones() {
  const layoutStore = useLayoutStore();
  const { applySplitDrop } = useSplitDropDrag();

  function onDragEnter(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.add("drag-over");
  }

  function onDragLeave(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
  }

  function onDrop(e: DragEvent, direction: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
    layoutStore.isShowDropZones = false;
    const raw = layoutStore.dragTabId || e.dataTransfer?.getData("text/plain");
    const tabId = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (tabId) {
      applySplitDrop(tabId, direction);
    }
    layoutStore.dragTabId = null;
  }

  return { onDragEnter, onDragLeave, onDrop };
}
