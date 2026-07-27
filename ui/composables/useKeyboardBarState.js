import { ref, computed, nextTick, onUnmounted, watch } from "vue";
import { on, emit } from "../app-bridge.js";

// スニペット/履歴の挿入は設定画面（Modal）側の画面として表示する。
// ボタンタップごとの巡回順（非表示 → Snippets → History → 非表示）は維持しつつ、
// 遷移先を設定モーダルの該当ビューへの pushView に置き換える。
const SNIPPET_PANEL_SETTINGS_VIEW = { snippets: "SendSnippet", history: "SendHistory" };

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
    const next = SNIPPET_PANEL_VIEWS[nextIndex];
    snippetPanelView.value = next;
    if (next === "none") {
      emit("modal:close");
      return;
    }
    clearModifiers();
    emit("settings:open", { view: SNIPPET_PANEL_SETTINGS_VIEW[next] });
  }

  function closeSnippetPanel() {
    if (snippetPanelView.value !== "none") emit("modal:close");
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
    // 設定モーダルが（Snippets/History以外の理由も含め）閉じたら巡回状態をリセットする。
    // そうしないと次のタップが「閉じる」扱いのまま出戻ってしまう。
    on("settings:closed", () => { snippetPanelView.value = "none"; }),
    on("keyboard:setDraft", async ({ command }) => {
      draft.value = command;
      await nextTick();
      keyboardInput.value?.focus?.();
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
    onInputFocused, toggleSnippetView, closeSnippetPanel,
    hideInput, dismissKeyboard, onSubmitted,
  };
}
