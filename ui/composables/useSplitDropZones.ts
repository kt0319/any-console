import { useLayoutStore } from "../stores/layout.ts";
import { useSplitDropDrag } from "./useSplitDropDrag.ts";

/**
 * ターミナル分割のドロップゾーン（HTML5 DnD 経由）用ハンドラ群。
 * - dragenter/dragleave で .drag-over クラスを切替
 * - drop で applySplitDrop（useSplitDropDrag と共通の確定処理）を呼ぶ
 *
 * ポインタ座標のヒットテストで確定する経路（タブ長押しドラッグ）は
 * useSplitDropDrag.finishSplitDrop 側。確定処理はどちらも applySplitDrop に
 * 一本化してある。
 */
export function useSplitDropZones() {
  const layoutStore = useLayoutStore();
  const { applySplitDrop } = useSplitDropDrag();

  function onDragEnter(e) {
    e.currentTarget.classList.add("drag-over");
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }

  function onDrop(e, direction) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    layoutStore.isShowDropZones = false;
    const raw = layoutStore.dragTabId || e.dataTransfer.getData("text/plain");
    const tabId = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (tabId) {
      applySplitDrop(tabId, direction);
    }
    layoutStore.dragTabId = null;
  }

  return { onDragEnter, onDragLeave, onDrop };
}
