import { ref } from "vue";

export function useFileDragDrop({ uploadFn, isDiffMode }) {
  const isDropActive = ref(false);
  let dragDepth = 0;

  function resetDropState() {
    dragDepth = 0;
    isDropActive.value = false;
  }

  function hasFileDrag(e) {
    const types = e?.dataTransfer?.types;
    return !!types && Array.from(types).includes("Files");
  }

  function onDragEnter(e) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    dragDepth += 1;
    isDropActive.value = true;
  }

  function onDragOver(e) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    e.preventDefault();
    isDropActive.value = true;
  }

  function onDragLeave(e) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    if (e.currentTarget?.contains(e.relatedTarget)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      isDropActive.value = false;
    }
  }

  async function onDropFiles(e) {
    if (isDiffMode() || !hasFileDrag(e)) return;
    e.preventDefault();
    resetDropState();
    const droppedFiles = Array.from(e?.dataTransfer?.files || []).filter((f) => f && f.name);
    if (droppedFiles.length === 0) return;
    await uploadFn(droppedFiles);
  }

  function onWindowDrop() {
    resetDropState();
  }

  function onWindowDragLeave(e) {
    if (!isDropActive.value) return;
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      resetDropState();
    }
  }

  async function onUploadInputChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await uploadFn(files);
    }
    e.target.value = "";
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
