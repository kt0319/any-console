import { ref } from "vue";
import type { Ref } from "vue";
import type { TerminalTab } from "../stores/terminal.ts";
import { useAuthStore } from "../stores/auth.ts";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.ts";
import { useToast } from "./useToast.ts";

function hasFileDrag(e: DragEvent) {
  const types = e?.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

// OSからのファイルドラッグ&ドロップで画像をターミナルに貼り付ける
// （useTerminalPasteのクリップボード画像貼り付けと同じアップロード経路を使う）。
export function useTerminalImageDrop({ tab }: { tab: Ref<TerminalTab> }) {
  const toast = useToast();
  const auth = useAuthStore();
  const isDropActive = ref(false);
  let dragDepth = 0;

  function onDragEnter(e: DragEvent) {
    if (!hasFileDrag(e)) return;
    dragDepth += 1;
    isDropActive.value = true;
  }

  function onDragOver(e: DragEvent) {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    isDropActive.value = true;
  }

  function onDragLeave(e: DragEvent) {
    if (!hasFileDrag(e)) return;
    if ((e.currentTarget as HTMLElement | null)?.contains(e.relatedTarget as Node | null)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isDropActive.value = false;
  }

  async function onDrop(e: DragEvent) {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    isDropActive.value = false;
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFile = files.find((f) => f.type.startsWith("image/"));
    if (!imageFile) {
      toast.show("Only image files can be dropped here", "error");
      return;
    }
    await uploadImageToTerminal({
      file: imageFile,
      apiFetch: auth.apiFetch.bind(auth),
      ws: tab.value.ws,
      notify: (message: string, type: string) => toast.show(message, type),
    });
  }

  return { isDropActive, onDragEnter, onDragOver, onDragLeave, onDrop };
}
