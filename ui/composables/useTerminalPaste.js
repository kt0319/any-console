import { onMounted, onBeforeUnmount } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { emit } from "../app-bridge.js";

export function useTerminalPaste({ tab, isActive }) {
  const auth = useAuthStore();

  async function onPaste(e) {
    if (!isActive.value) return;

    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;

    if (imageFile) {
      e.preventDefault();
      emit("keyboard:deactivate");
      await uploadImageToTerminal({
        file: imageFile,
        apiFetch: auth.apiFetch.bind(auth),
        ws: tab.value.ws,
        notify: (message, type) => emit("toast:show", { message, type }),
      });
      return;
    }

    // xterm の textarea にフォーカスがないとき、テキストをターミナルに転送する。
    // input/textarea/select/contenteditable にフォーカスがある場合は転送しない（ダイアログ等を壊さないため）。
    const textarea = tab.value.term?.textarea;
    const activeEl = /** @type {HTMLElement | null} */ (document.activeElement);
    const activeIsOtherInput = activeEl && activeEl !== textarea && (
      activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.tagName === "SELECT" ||
      activeEl.isContentEditable
    );
    if (textarea && !activeIsOtherInput && activeEl !== textarea) {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        tab.value.term.paste(text);
      }
    }
  }

  onMounted(() => {
    document.addEventListener("paste", onPaste, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("paste", onPaste, true);
  });
}
