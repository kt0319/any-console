import { onMounted, onBeforeUnmount } from "vue";
import type { Ref } from "vue";
import type { TerminalTab } from "../stores/terminal.ts";
import { useAuthStore } from "../stores/auth.ts";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.ts";
import { isEditableTarget } from "../utils/dom.ts";
import { emit } from "../app-bridge.ts";
import { useToast } from "./useToast.ts";

export function useTerminalPaste({ tab, isActive }: { tab: Ref<TerminalTab>, isActive: Ref<boolean> }) {
  const toast = useToast();
  const auth = useAuthStore();

  async function onPaste(e: ClipboardEvent) {
    if (!isActive.value) return;

    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;

    if (imageFile) {
      e.preventDefault();
      // xterm も textarea に paste リスナーを持ち preventDefault() では伝播を止められない。右クリック Paste では
      // text/plain も乗り画像が二重に貼られるため、ここで確定させたら伝播させない。
      e.stopPropagation();
      emit("keyboard:deactivate");
      await uploadImageToTerminal({
        file: imageFile,
        apiFetch: auth.apiFetch.bind(auth),
        ws: tab.value.ws,
        notify: (message: string, type: string) => toast.show(message, type),
      });
      return;
    }

    // xterm の textarea にフォーカスが無い時だけ転送する。input/textarea/select/contenteditable 上では転送しない。
    // element 配下にフォーカスがある間は xterm 側に委ねる（二重貼り付け防止）。
    const textarea = tab.value.term?.textarea;
    const termElement = tab.value.term?.element;
    const activeEl = document.activeElement as HTMLElement | null;
    const activeIsOtherInput = activeEl && activeEl !== textarea && isEditableTarget(activeEl);
    const focusInsideTerm = activeEl && termElement && termElement.contains(activeEl);
    if (textarea && !activeIsOtherInput && !focusInsideTerm) {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        // textarea が非 null なら term も非 null（textarea は term?.textarea 由来）
        tab.value.term!.paste(text);
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
