import { ref } from "vue";

const MENU_CLOSE_DELAY_MS = 150;
export const isHoverDevice = window.matchMedia("(hover: hover)").matches;

export function useHoverMenu() {
  const contextEntry = ref(null);
  let hoverCloseTimer = null;

  function openMenu(entry) { contextEntry.value = entry; }
  function closeMenu() { contextEntry.value = null; }

  function onItemMouseEnter(entry) {
    if (!isHoverDevice) return;
    clearTimeout(hoverCloseTimer);
    contextEntry.value = entry;
  }

  function onItemMouseLeave() {
    if (!isHoverDevice) return;
    hoverCloseTimer = setTimeout(closeMenu, MENU_CLOSE_DELAY_MS);
  }

  function onMenuMouseEnter() {
    clearTimeout(hoverCloseTimer);
  }

  function onMenuMouseLeave() {
    hoverCloseTimer = setTimeout(closeMenu, MENU_CLOSE_DELAY_MS);
  }

  return {
    contextEntry,
    openMenu, closeMenu,
    onItemMouseEnter, onItemMouseLeave,
    onMenuMouseEnter, onMenuMouseLeave,
  };
}
