import { ref } from "vue";
import { emit } from "../app-bridge.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";

/**
 * カメラ起動と撮影画像のターミナルへのアップロードをまとめる。
 */
export function useQwertyCamera({ apiFetch, getActiveTerminalTab, onBeforeUpload }) {
  const cameraInputEl = ref(null);

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
      notify: (message, type) => emit("toast:show", { message, type }),
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
