import { ref } from "vue";
import { collectDroppedFileEntries } from "../utils/file-drop-entries.ts";

type DroppedEntry = { file: File, relativePath: string };

export function useFileDragDrop({ uploadFn, isDiffMode }: {
  uploadFn: (entries: DroppedEntry[]) => Promise<void> | void,
  isDiffMode: () => boolean,
}) {
  const isDropActive = ref(false);
  let dragDepth = 0;

  function resetDropState() {
    dragDepth = 0;
    isDropActive.value = false;
  }

  function hasFileDrag(e: DragEvent) {
    const types = e?.dataTransfer?.types;
    return !!types && Array.from(types).includes("Files");
  }

  function onDragEnter(e: DragEvent) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    dragDepth += 1;
    isDropActive.value = true;
  }

  function onDragOver(e: DragEvent) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    e.preventDefault();
    isDropActive.value = true;
  }

  function onDragLeave(e: DragEvent) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    if ((e.currentTarget as HTMLElement | null)?.contains(e.relatedTarget as Node | null)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      isDropActive.value = false;
    }
  }

  async function onDropFiles(e: DragEvent) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    e.preventDefault();
    resetDropState();
    const entries = await collectDroppedFileEntries(e?.dataTransfer);
    if (entries.length === 0) return;
    await uploadFn(entries);
  }

  function onWindowDrop() {
    resetDropState();
  }

  function onWindowDragLeave(e: DragEvent) {
    if (!isDropActive.value) return;
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      resetDropState();
    }
  }

  async function onUploadInputChange(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (files.length > 0) {
      const entries = files.map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
      await uploadFn(entries);
    }
    (e.target as HTMLInputElement).value = "";
  }

  function setupWindowListeners() {
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("dragleave", onWindowDragLeave);
  }

  function cleanupWindowListeners() {
    window.removeEventListener("drop", onWindowDrop);
    window.removeEventListener("dragleave", onWindowDragLeave);
  }

  return {
    isDropActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDropFiles,
    onWindowDrop,
    onWindowDragLeave,
    onUploadInputChange,
    setupWindowListeners,
    cleanupWindowListeners,
  };
}
