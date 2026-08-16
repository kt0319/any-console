import { ref } from "vue";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.ts";
import { useToast } from "./useToast.ts";
import type { TerminalTab } from "../stores/terminal.ts";

/**
 * カメラ起動と撮影画像のターミナルへのアップロードをまとめる。
 */
export function useQwertyCamera({ apiFetch, getActiveTerminalTab, onBeforeUpload }: {
  apiFetch: (url: string, init?: { method?: string, body?: any }) => Promise<Response | null | undefined>,
  getActiveTerminalTab: () => TerminalTab | null,
  onBeforeUpload: () => void,
}) {
  const toast = useToast();
  const cameraInputEl = ref<HTMLInputElement | null>(null);

  function openCamera() {
    const el = cameraInputEl.value;
    if (!el) return;
    el.value = "";
    el.click();
  }

  async function uploadImageAndSendPath(file: File | null | undefined) {
    if (!file) return;
    const tab = getActiveTerminalTab();
    await uploadImageToTerminal({
      file,
      apiFetch,
      ws: tab?.ws,
      notify: (message: string, type: string) => toast.show(message, type),
    });
  }

  async function onCameraFileChange(e: Event) {
    const file = (e.target as HTMLInputElement | null)?.files?.[0];
    if (!file) return;
    onBeforeUpload();
    await uploadImageAndSendPath(file);
  }

  return { cameraInputEl, openCamera, onCameraFileChange };
}
