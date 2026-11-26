import { ref, computed, nextTick, watch, type Ref } from "vue";
import { emit } from "../app-bridge.ts";
import { useBusListener } from "./useBusListener.ts";

export function useKeyboardBarState({ keyboardInput, clearModifiers }: {
  keyboardInput: Ref<any>,
  clearModifiers: () => void,
}) {
  const isFullKeyboard = ref(false);
  const draft = ref("");
  const inputFocused = ref(false);
  const snippetPanelView = ref("none");
  const showSnippetView = computed(() => snippetPanelView.value !== "none");
  const hasDraft = computed(() => draft.value.trim().length > 0);

  function onInputFocused(focused: boolean) {
    inputFocused.value = !!focused;
  }

  // History/Snippet タブは選択式。開いている方を再タップしても閉じない（閉じるのは QWERTY タブ/×ボタンに一本化）
  function openSnippetPanelView(view: string) {
    snippetPanelView.value = view;
    clearModifiers();
  }

  function openSnippetPanel() {
    openSnippetPanelView("snippets");
  }

  function openHistoryPanel() {
    openSnippetPanelView("history");
  }

  function closeSnippetPanel() {
    snippetPanelView.value = "none";
  }

  function hideInput() {
    isFullKeyboard.value = false;
    clearModifiers();
  }

  function dismissKeyboard() {
    if (inputFocused.value) {
      keyboardInput.value?.blur?.();
      inputFocused.value = false;
      clearModifiers();
      if (!isFullKeyboard.value) return;
    }
    if (isFullKeyboard.value) {
      isFullKeyboard.value = false;
      clearModifiers();
      return;
    }
    isFullKeyboard.value = true;
    closeSnippetPanel();
    clearModifiers();
  }

  function onSubmitted() {
    hideInput();
  }

  useBusListener("keyboard:deactivate", hideInput);
  useBusListener("keyboard:setDraft", ({ command }) => {
    draft.value = command;
  });

  // 高さ変化で terminal 領域も変わるため、ResizeObserver の debounce を待たず即 fit を要求する
  watch([isFullKeyboard, inputFocused], async () => {
    await nextTick();
    emit("layout:fitAll", { force: true });
  });

  return {
    isFullKeyboard, draft, inputFocused, showSnippetView, snippetPanelView, hasDraft,
    onInputFocused, openSnippetPanel, openHistoryPanel, closeSnippetPanel,
    hideInput, dismissKeyboard, onSubmitted,
  };
}
