import { ref, computed, nextTick, onUnmounted, watch } from "vue";
import { useInputStore } from "../stores/input.js";
import { on, emit } from "../app-bridge.js";

/**
 * KeyboardBar の入力 / スニペット状態とキーボード開閉を管理する。
 *
 * @param {Object} deps
 * @param {import('vue').Ref} deps.keyboardInput KeyboardInput コンポーネントへの ref
 * @param {() => void} deps.clearModifiers
 * @param {(text: string) => void} deps.sendTextToTerminal
 */
export function useKeyboardBarState({ keyboardInput, clearModifiers, sendTextToTerminal }) {
  const inputStore = useInputStore();

  // ─── 入力 / スニペット状態 ─────────────────────────────────────
  const isFullKeyboard = ref(false);
  const draft = ref("");
  const inputFocused = ref(false);
  const showSnippetView = ref(false);
  const hasDraft = computed(() => draft.value.trim().length > 0);

  function onInputFocused(focused) {
    inputFocused.value = !!focused;
  }

  function toggleSnippetView() {
    showSnippetView.value = !showSnippetView.value;
    if (showSnippetView.value) clearModifiers();
  }

  function onChipTap({ command }) {
    if (inputFocused.value) {
      draft.value = command;
      keyboardInput.value?.focus?.();
    } else {
      sendTextToTerminal(command);
      inputStore.addInputHistory(command);
    }
    showSnippetView.value = false;
  }

  // ─── キーボード開閉 ────────────────────────────────────────────
  function hideInput() {
    isFullKeyboard.value = false;
    clearModifiers();
  }

  function toggleKeyboard() {
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
    showSnippetView.value = false;
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
    isFullKeyboard, draft, inputFocused, showSnippetView, hasDraft,
    onInputFocused, toggleSnippetView, onChipTap,
    hideInput, toggleKeyboard, dismissKeyboard, onSubmitted,
  };
}
