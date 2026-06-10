import { ref } from "vue";
import { HOVER_MENU_CLOSE_DELAY_MS } from "../utils/constants.js";

export const isHoverDevice = window.matchMedia("(hover: hover)").matches;

export function useHoverMenu() {
  const contextEntry = ref(/** @type {any} */ (null));
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
    hoverCloseTimer = setTimeout(closeMenu, HOVER_MENU_CLOSE_DELAY_MS);
  }

  function onMenuMouseEnter() {
    clearTimeout(hoverCloseTimer);
  }

  function onMenuMouseLeave() {
    hoverCloseTimer = setTimeout(closeMenu, HOVER_MENU_CLOSE_DELAY_MS);
  }

  return {
    contextEntry,
    openMenu, closeMenu,
    onItemMouseEnter, onItemMouseLeave,
    onMenuMouseEnter, onMenuMouseLeave,
  };
}
