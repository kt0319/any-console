import { ref } from "vue";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { useToast } from "./useToast.js";

/**
 * カメラ起動と撮影画像のターミナルへのアップロードをまとめる。
 */
export function useQwertyCamera({ apiFetch, getActiveTerminalTab, onBeforeUpload }) {
  const toast = useToast();
  const cameraInputEl = ref(/** @type {HTMLInputElement|null} */ (null));

  function openCamera() {
    const el = cameraInputEl.value;
    if (!el) return;
    el.value = "";
    el.click();
  }

  async function uploadImageAndSendPath(file) {
    if (!file) return;
    const tab = getActiveTerminalTab();
    await uploadImageToTerminal({
      file,
      apiFetch,
      ws: tab?.ws,
      notify: (message, type) => toast.show(message, type),
    });
  }

  async function onCameraFileChange(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    onBeforeUpload();
    await uploadImageAndSendPath(file);
  }

  return { cameraInputEl, openCamera, onCameraFileChange };
}
