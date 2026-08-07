import { ref } from "vue";
import { useLayoutStore } from "../stores/layout.js";
import { KEYBOARD_CLOSE_DELAY_MS, KEYBOARD_OPEN_DELAY_MS, DEBOUNCE_FIT_MS, ORIENTATION_CHANGE_DELAY_MS, DOUBLE_TAP_ZOOM_PREVENT_MS } from "../utils/constants.js";

let initialized = false;
const keyboardOpen = ref(false);
let keyboardCloseTimer = null;
let keyboardOpenTimer = null;
let fitDebounceTimer = null;
let orientationFitTimer = null;
let prevViewportHeightPx = 0;
let onFitCallback = null;

function updateViewportHeight() {
  const layoutStore = useLayoutStore();
  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const viewportHeightPx = Math.round(viewportHeight);
  const isKbOpen = !!(vv && (window.innerHeight - vv.height > 100));
  const useFullHeight = layoutStore.isPwa && !isKbOpen;
  const appliedViewportHeightPx = useFullHeight
    ? Math.round(window.innerHeight)
    : viewportHeightPx;

  if (prevViewportHeightPx !== appliedViewportHeightPx) {
    prevViewportHeightPx = appliedViewportHeightPx;
    document.documentElement.style.setProperty("--app-dvh", `${appliedViewportHeightPx}px`);
  }

  const prevOpen = keyboardOpen.value;
  keyboardOpen.value = isKbOpen;

  if (prevOpen && !isKbOpen) {
    if (keyboardOpenTimer) { clearTimeout(keyboardOpenTimer); keyboardOpenTimer = null; }
    if (keyboardCloseTimer) clearTimeout(keyboardCloseTimer);
    keyboardCloseTimer = setTimeout(() => {
      keyboardCloseTimer = null;
      if (onFitCallback) onFitCallback({ scrollToBottom: true });
    }, KEYBOARD_CLOSE_DELAY_MS);
  } else if (!prevOpen && isKbOpen) {
    if (keyboardOpenTimer) clearTimeout(keyboardOpenTimer);
    keyboardOpenTimer = setTimeout(() => {
      keyboardOpenTimer = null;
      if (onFitCallback) onFitCallback({ scrollToBottom: true });
    }, KEYBOARD_OPEN_DELAY_MS);
  } else if (!isKbOpen) {
    debouncedFit();
  }
}

function debouncedFit() {
  if (orientationFitTimer) return;
  if (keyboardCloseTimer) return;
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  fitDebounceTimer = setTimeout(() => {
    fitDebounceTimer = null;
    if (onFitCallback) onFitCallback();
  }, DEBOUNCE_FIT_MS);
}

export function useViewport() {
  function initViewport(fitCallback) {
    if (initialized) return;
    initialized = true;
    onFitCallback = fitCallback;

    updateViewportHeight();
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewportHeight);
      window.visualViewport.addEventListener("scroll", updateViewportHeight);
    }
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", () => {
      if (orientationFitTimer) clearTimeout(orientationFitTimer);
      orientationFitTimer = setTimeout(() => {
        orientationFitTimer = null;
        updateViewportHeight();
      }, ORIENTATION_CHANGE_DELAY_MS);
    });

    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
      // .tab-menu-btn（ハンバーガー）と .keyboard-bar（モード切替タブ・クイックキー・
      // 埋め込みSnippet/Historyパネル）は、すぐ連打されうる操作面なので
      // ダブルタップズーム防止の対象から除外する（.modal-overlay 内と同じ扱い。
      // preventDefault すると click が合成されず @click のボタンが効かなくなる）。
      if (/** @type {Element} */ (e.target)?.closest?.(".modal-overlay, .tab-menu-btn, .keyboard-bar")) return;
      const now = Date.now();
      if (now - lastTouchEnd <= DOUBLE_TAP_ZOOM_PREVENT_MS) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  }

  function getKeyboardBottomOffset() {
    const vv = window.visualViewport;
    if (!vv) return 0;
    return window.innerHeight - (vv.offsetTop + vv.height);
  }

  return {
    keyboardOpen,
    initViewport,
    getKeyboardBottomOffset,
    requestFit: debouncedFit,
  };
}
