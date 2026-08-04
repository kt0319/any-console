import { onMounted, onBeforeUnmount } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { emit } from "../app-bridge.js";

// 非split時は非アクティブなタブも v-show で表示切替するだけでマウントされ
// 続けるため（TerminalBase.vue）、開いているタブの数だけ document への
// paste リスナーが登録される。isActiveガードで通常は1つしか処理に進まない
// はずだが、PWA環境でCtrl+V/右クリック貼り付けの両方から同一画像が2枚
// 貼り付けられる不具合が報告されており、ブラウザ側でpasteイベントが
// 二重発火している可能性がある。モジュール全体で共有する短時間ロックで
// 同一画像の連続処理を弾く。
let lastImagePasteAt = 0;
const IMAGE_PASTE_DEDUPE_MS = 500;

export function useTerminalPaste({ tab, isActive }) {
  const auth = useAuthStore();

  async function onPaste(e) {
    if (!isActive.value) return;

    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;

    if (imageFile) {
      const now = Date.now();
      if (now - lastImagePasteAt < IMAGE_PASTE_DEDUPE_MS) {
        e.preventDefault();
        return;
      }
      lastImagePasteAt = now;
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
