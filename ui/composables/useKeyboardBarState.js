import { ref, computed, nextTick, onUnmounted, watch } from "vue";
import { on, emit } from "../app-bridge.js";

/**
 * KeyboardBar の入力 / スニペット状態とキーボード開閉を管理する。
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.keyboardInput KeyboardInput コンポーネントへの ref
 * @param {() => void} deps.clearModifiers
 */
export function useKeyboardBarState({ keyboardInput, clearModifiers }) {
  // ─── 入力 / スニペット状態 ─────────────────────────────────────
  const isFullKeyboard = ref(false);
  const draft = ref("");
  const inputFocused = ref(false);
  const snippetPanelView = ref("none");
  const showSnippetView = computed(() => snippetPanelView.value !== "none");
  const hasDraft = computed(() => draft.value.trim().length > 0);

  function onInputFocused(focused) {
    inputFocused.value = !!focused;
  }

  // History/Snippetタブの直接選択。fnビューと同じくQWERTYパネル内に直接
  // オーバーレイ表示する（設定モーダルは開かない）。タブ帯の他のタブと同じく
  // 選択式（トグルではない）にするため、既に開いている方を再タップしても
  // 閉じない（閉じる操作はQWERTYタブ/×ボタンに一本化）。
  function openSnippetPanelView(view) {
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

  // ─── キーボード開閉 ────────────────────────────────────────────
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

  const cleanups = [
    on("keyboard:deactivate", hideInput),
    on("keyboard:setDraft", ({ command }) => {
      draft.value = command;
    }),
  ];
  onUnmounted(() => cleanups.forEach((fn) => fn()));

  // 入力モード切替で keyboard-bar の高さが変わると terminal 領域も縮む / 広がる。
  // ResizeObserver の debounce を待たず、即座に fit を要求して旧サイズでの描画を最小化する。
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
