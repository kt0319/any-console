import { watch } from "vue";
import { useInputStore } from "../stores/input.js";

export function useInputDraftHistory(draft, inputFocused, sendTextToTerminal, { onSend } = {}) {
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
    if (snippetIndex === -1) savedSnippetDraft = draft.value;
    const next = snippetIndex + dir;
    if (next < 0) {
      snippetIndex = -1;
      if (inputFocused.value) draft.value = savedSnippetDraft;
      return;
    }
    snippetIndex = Math.min(next, list.length - 1);
    const command = list[snippetIndex]?.command;
    if (!command) return;
    if (inputFocused.value) {
      draft.value = command;
    } else {
      sendTextToTerminal(command);
      inputStore.addInputHistory(command);
      onSend?.();
    }
  }

  return { historyPrev, historyNext, cycleSnippet };
}
