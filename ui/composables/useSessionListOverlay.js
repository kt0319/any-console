import { computed } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.js";

// セッション一覧オーバーレイ（PC: SessionSidebar.vue / モバイル: Modal.vue が
// SessionListPanel.vueをホストする）の開閉を一箇所に集約する薄いcomposable。
// 実体はlayoutStore.isSessionSidebarOpenのラップで、TabBar.vueのハンバーガー・
// useSettingsNav.jsの旧SessionListへのリダイレクト・SessionListPanel.vueの
// 閉じるボタンが同じロジックを重複させないための共通化。

let registered = false;

function registerOnce() {
  if (registered) return;
  registered = true;
  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("sessionList", close);
}

function open() {
  registerOnce();
  const { closeOthersOn } = useExclusiveMobileOverlay();
  closeOthersOn("sessionList");
  useLayoutStore().isSessionSidebarOpen = true;
}

function close() {
  useLayoutStore().isSessionSidebarOpen = false;
}

export function useSessionListOverlay() {
  registerOnce();
  return {
    isOpen: computed(() => useLayoutStore().isSessionSidebarOpen),
    open,
    close,
  };
}
