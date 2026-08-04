import { onMounted, onBeforeUnmount } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { emit } from "../app-bridge.js";
import { debugLog } from "./useClientLogs.js";

// 右クリックの「Paste」から画像を貼り付けると2枚アップロードされる不具合を
// 調査中。原因特定まではデバッグログのみ（デバッグモードON時、Settings >
// System Info のログに出る）で発火状況を可視化する。原因が分かり次第、
// 対症療法ではなく発生源を止める形に直す。
let pasteEventSeq = 0;

export function useTerminalPaste({ tab, isActive }) {
  const auth = useAuthStore();

  async function onPaste(e) {
    const seq = ++pasteEventSeq;
    debugLog(`[terminal-paste #${seq}] fired type=${e.type} isTrusted=${e.isTrusted} timeStamp=${e.timeStamp.toFixed(1)} isActive=${isActive.value} tabId=${tab.value?.id}`);
    if (!isActive.value) return;

    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;

    if (imageFile) {
      debugLog(`[terminal-paste #${seq}] image detected name=${imageFile.name} size=${imageFile.size} lastModified=${imageFile.lastModified}`);
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
    // xterm 自身も textarea と element の両方に paste リスナーを持つため、フォーカスが
    // element 配下（textarea 含む）にある間は xterm 側に処理を委ねる（二重貼り付け防止）。
    const textarea = tab.value.term?.textarea;
    const termElement = tab.value.term?.element;
    const activeEl = /** @type {HTMLElement | null} */ (document.activeElement);
    const activeIsOtherInput = activeEl && activeEl !== textarea && (
      activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.tagName === "SELECT" ||
      activeEl.isContentEditable
    );
    const focusInsideTerm = activeEl && termElement && termElement.contains(activeEl);
    if (textarea && !activeIsOtherInput && !focusInsideTerm) {
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
