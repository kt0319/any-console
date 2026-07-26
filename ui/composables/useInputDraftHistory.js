import { watch } from "vue";
import { useInputStore } from "../stores/input.js";

/**
 * @param {import('vue').Ref<string>} draft
 */
export function useInputDraftHistory(draft) {
  const inputStore = useInputStore();

  let historyIndex = -1;
  // history ナビ開始前の途中入力（history を抜けたときに復元する）
  let savedHistoryDraft = "";

  watch(draft, (val) => {
    if (val === "") historyIndex = -1;
  });

  function historyPrev() {
    const list = inputStore.inputHistory;
    if (!list.length) return;
    if (historyIndex === -1) savedHistoryDraft = draft.value;
    historyIndex = Math.min(historyIndex + 1, list.length - 1);
    draft.value = list[historyIndex];
  }

  function historyNext() {
    if (historyIndex === -1) return;
    historyIndex -= 1;
    if (historyIndex < 0) {
      historyIndex = -1;
      draft.value = savedHistoryDraft;
      return;
    }
    draft.value = inputStore.inputHistory[historyIndex];
  }

  return { historyPrev, historyNext };
}
