import { watch } from "vue";
import { useInputStore } from "../stores/input.js";

/**
 * @param {import('vue').Ref<string>} draft
 * @param {import('vue').Ref<boolean>} inputFocused
 * @param {(text: string) => void} sendTextToTerminal
 * @param {{ onSend?: () => void }} [opts]
 */
export function useInputDraftHistory(draft, inputFocused, sendTextToTerminal, { onSend = undefined } = {}) {
  const inputStore = useInputStore();

  let historyIndex = -1;
  // history ナビ開始前の途中入力（history を抜けたときに復元する）
  let savedHistoryDraft = "";

  let snippetIndex = -1;
  // snippet ナビ開始前の途中入力（snippet を抜けたときに復元する）
  let savedSnippetDraft = "";

  watch(draft, (val) => {
    if (val === "") {
      historyIndex = -1;
      snippetIndex = -1;
    }
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

  function cycleSnippet(dir) {
    const list = inputStore.snippetsCache;
    if (!list.length) return;
    if (inputFocused.value) {
      // 入力中は左右でスニペットを順送り。境界を越えたら snippet 開始前の状態に戻る。
      if (snippetIndex === -1) {
        savedSnippetDraft = draft.value;
        snippetIndex = dir > 0 ? 0 : list.length - 1;
      } else {
        const next = snippetIndex + dir;
        if (next < 0 || next >= list.length) {
          snippetIndex = -1;
          draft.value = savedSnippetDraft;
          return;
        }
        snippetIndex = next;
      }
      const command = list[snippetIndex]?.command;
      if (command) draft.value = command;
      return;
    }
    // 非フォーカス時は順送りで端まで進んだら snippet 開始前の状態に戻る
    if (snippetIndex === -1) savedSnippetDraft = draft.value;
    const next = snippetIndex + dir;
    if (next < 0) {
      snippetIndex = -1;
      draft.value = savedSnippetDraft;
      return;
    }
    snippetIndex = Math.min(next, list.length - 1);
    const command = list[snippetIndex]?.command;
    if (!command) return;
    sendTextToTerminal(command);
    inputStore.addInputHistory(command);
    onSend?.();
  }

  return { historyPrev, historyNext, cycleSnippet };
}
