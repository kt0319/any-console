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
  let savedDraft = "";
  let snippetIndex = -1;
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
    if (historyIndex === -1) savedDraft = draft.value;
    historyIndex = Math.min(historyIndex + 1, list.length - 1);
    draft.value = list[historyIndex];
  }

  function historyNext() {
    if (historyIndex === -1) return;
    historyIndex -= 1;
    if (historyIndex < 0) {
      historyIndex = -1;
      draft.value = savedDraft;
      return;
    }
    draft.value = inputStore.inputHistory[historyIndex];
  }

  function cycleSnippet(dir) {
    const list = inputStore.snippetsCache;
    if (!list.length) return;
    if (inputFocused.value) {
      // 入力中は左右で末尾⇄先頭をループする
      if (snippetIndex === -1) {
        savedSnippetDraft = draft.value;
        snippetIndex = dir > 0 ? 0 : list.length - 1;
      } else {
        snippetIndex = (snippetIndex + dir + list.length) % list.length;
      }
      const command = list[snippetIndex]?.command;
      if (command) draft.value = command;
      return;
    }
    // 非フォーカス時は順送りで端まで進んだら原稿に戻る既存挙動
    if (snippetIndex === -1) savedSnippetDraft = draft.value;
    const next = snippetIndex + dir;
    if (next < 0) {
      snippetIndex = -1;
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
