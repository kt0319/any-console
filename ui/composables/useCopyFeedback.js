// @ts-check
import { ref } from "vue";
import { copyText } from "../utils/clipboard.js";
import { URL_COPIED_RESET_MS } from "../utils/constants.js";

/**
 * クリップボードコピー＋成功フィードバック（一定時間後に自動で戻るcopiedフラグ）。
 * @returns {{ copied: import("vue").Ref<boolean>, copy: (text: string) => Promise<boolean> }}
 */
export function useCopyFeedback() {
  const copied = ref(false);

  async function copy(text) {
    copied.value = await copyText(text);
    if (copied.value) {
      setTimeout(() => { copied.value = false; }, URL_COPIED_RESET_MS);
    }
    return copied.value;
  }

  return { copied, copy };
}
