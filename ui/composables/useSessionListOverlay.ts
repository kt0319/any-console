import { computed, ref } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useExclusiveOverlay } from "./useExclusiveOverlay.ts";
import { isTouchOnly } from "../utils/keyboard.ts";

let registered = false;

// 開いた直後に検索入力（SessionListPanel.vue）へフォーカスする要求。サイドバーがまだ
// 描画されていない場合はマウント時にSessionListPanel.vueが消費する。リロード時の開閉状態の
// 復元ではopen()を通らないため、ターミナルのフォーカスを奪わない。
export const searchFocusRequested = ref(false);
export const isSearchFocused = ref(false);

function registerOnce() {
  if (registered) return;
  registered = true;
  const { registerOverlay } = useExclusiveOverlay();
  registerOverlay("sessionList", close);
}

// focusSearch の既定はソフトキーボードの誤起動を避けるためタッチ専用端末では false。
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
