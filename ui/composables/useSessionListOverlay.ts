import { computed, ref } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useExclusiveOverlay } from "./useExclusiveOverlay.ts";
import { isTouchOnly } from "../utils/keyboard.ts";

// セッション一覧オーバーレイ（PC: SessionSidebar.vue / モバイル: SessionListOverlay.vue が
// SessionListPanel.vueをホストする）の開閉を一箇所に集約する薄いcomposable。
// 実体はlayoutStore.isSessionSidebarOpenのラップで、TabBar.vueのハンバーガー・
// useSettingsNav.tsの旧SessionListへのリダイレクト・SessionListPanel.vueの
// 閉じるボタンが同じロジックを重複させないための共通化。

let registered = false;

// 開いた直後に検索入力（SessionListPanel.vue）へフォーカスする要求。サイドバーがまだ
// 描画されていない場合はマウント時にSessionListPanel.vueが消費する。リロード時の開閉状態の
// 復元ではopen()を通らないため、ターミナルのフォーカスを奪わない。
export const searchFocusRequested = ref(false);
// 検索入力にフォーカスがあるか。command-palette:open の再入力で閉じる（トグル）判定に使う。
export const isSearchFocused = ref(false);

function registerOnce() {
  if (registered) return;
  registered = true;
  const { registerOverlay } = useExclusiveOverlay();
  registerOverlay("sessionList", close);
}

// focusSearch の既定はソフトキーボードの誤起動を避けるためタッチ専用端末では false。
// 検索を明示して開く場合（command-palette:open）は端末に関わらず true を渡す。
function open({ focusSearch = !isTouchOnly() }: { focusSearch?: boolean } = {}) {
  registerOnce();
  const { closeOthersOn } = useExclusiveOverlay();
  closeOthersOn("sessionList");
  useLayoutStore().isSessionSidebarOpen = true;
  if (focusSearch) searchFocusRequested.value = true;
}

function close() {
  useLayoutStore().isSessionSidebarOpen = false;
}

export function useSessionListOverlay() {
  registerOnce();
  return {
    isOpen: computed(() => useLayoutStore().isSessionSidebarOpen),
    searchFocusRequested,
    isSearchFocused,
    open,
    close,
  };
}
