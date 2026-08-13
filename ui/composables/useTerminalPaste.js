import { onMounted, onBeforeUnmount } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.ts";
import { isEditableTarget } from "../utils/dom.ts";
import { emit } from "../app-bridge.js";
import { useToast } from "./useToast.js";

export function useTerminalPaste({ tab, isActive }) {
  const toast = useToast();
  const auth = useAuthStore();

  async function onPaste(e) {
    if (!isActive.value) return;

    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;

    if (imageFile) {
      e.preventDefault();
      // xterm 自身も textarea に paste リスナーを持っており、preventDefault()
      // だけではそちらへの伝播を止められない。右クリックの「Paste」経由だと
      // クリップボードに text/plain（ファイルパス等）も同時に乗っていることが
      // あり、xterm 側がそれを別途ペーストして「画像が2つ貼り付く」ように
      // 見える不具合があった。ここで処理を確定させたらそれ以上伝播させない。
      e.stopPropagation();
      emit("keyboard:deactivate");
      await uploadImageToTerminal({
        file: imageFile,
        apiFetch: auth.apiFetch.bind(auth),
        ws: tab.value.ws,
        notify: (message, type) => toast.show(message, type),
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
    const activeIsOtherInput = activeEl && activeEl !== textarea && isEditableTarget(activeEl);
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
