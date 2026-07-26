import { ref, computed, nextTick, onUnmounted, watch } from "vue";
import { on, emit } from "../app-bridge.js";

/**
 * KeyboardBar の入力 / スニペット状態とキーボード開閉を管理する。
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.keyboardInput KeyboardInput コンポーネントへの ref
 * @param {() => void} deps.clearModifiers
 * @param {(command: string) => void} deps.moveSnippetToFront
 */
export function useKeyboardBarState({ keyboardInput, clearModifiers, moveSnippetToFront }) {
  // ─── 入力 / スニペット状態 ─────────────────────────────────────
  const isFullKeyboard = ref(false);
  const draft = ref("");
  const inputFocused = ref(false);
  // ボタンタップごとの巡回順: 非表示 → スニペット一覧 → 入力履歴 → 非表示…
  const SNIPPET_PANEL_VIEWS = ["none", "snippets", "history"];
  const snippetPanelView = ref("none");
  const showSnippetView = computed(() => snippetPanelView.value !== "none");
  const hasDraft = computed(() => draft.value.trim().length > 0);

  function onInputFocused(focused) {
    inputFocused.value = !!focused;
  }

  function toggleSnippetView() {
    const nextIndex = (SNIPPET_PANEL_VIEWS.indexOf(snippetPanelView.value) + 1) % SNIPPET_PANEL_VIEWS.length;
    snippetPanelView.value = SNIPPET_PANEL_VIEWS[nextIndex];
    if (showSnippetView.value) clearModifiers();
  }

  function closeSnippetPanel() {
    snippetPanelView.value = "none";
  }

  function onChipTap({ command }) {
    draft.value = command;
    const wasSnippets = snippetPanelView.value === "snippets";
    closeSnippetPanel();
    if (wasSnippets) moveSnippetToFront(command);
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
  ];
  onUnmounted(() => cleanups.forEach((fn) => fn()));

  // 入力モード切替で keyboard-bar の高さが変わると terminal 領域も縮む / 広がる。
  // ResizeObserver の debounce を待たず、即座に fit を要求して旧サイズでの描画を最小化する。
  watch([isFullKeyboard, inputFocused, showSnippetView], async () => {
    await nextTick();
    emit("layout:fitAll", { force: true });
  });

  return {
    isFullKeyboard, draft, inputFocused, showSnippetView, snippetPanelView, hasDraft,
    onInputFocused, toggleSnippetView, closeSnippetPanel, onChipTap,
    hideInput, dismissKeyboard, onSubmitted,
  };
}
