import { ref } from "vue";
import { useLayoutStore } from "../stores/layout.js";

let initialized = false;
const keyboardOpen = ref(false);
let keyboardCloseTimer = null;
let fitDebounceTimer = null;
let prevViewportHeightPx = 0;
let onFitCallback = null;

function updateViewportHeight() {
  const layoutStore = useLayoutStore();
  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const viewportHeightPx = Math.round(viewportHeight);
  const isKbOpen = vv && (window.innerHeight - vv.height > 100);
  const useFullHeight = layoutStore.isPwa && !isKbOpen;
  const appliedViewportHeightPx = useFullHeight
    ? Math.round(window.innerHeight)
    : viewportHeightPx;

  if (prevViewportHeightPx !== appliedViewportHeightPx) {
    prevViewportHeightPx = appliedViewportHeightPx;
    document.documentElement.style.setProperty("--app-dvh", `${appliedViewportHeightPx}px`);
  }

  const mainPanel = document.querySelector(".main-panel");
  if (mainPanel) mainPanel.classList.toggle("keyboard-open", isKbOpen);

  const prevOpen = keyboardOpen.value;
  keyboardOpen.value = isKbOpen;

  if (prevOpen && !isKbOpen) {
    if (keyboardCloseTimer) clearTimeout(keyboardCloseTimer);
    keyboardCloseTimer = setTimeout(() => {
      keyboardCloseTimer = null;
      if (onFitCallback) onFitCallback();
    }, 500);
  } else if (!isKbOpen) {
    debouncedFit();
  }
}

function debouncedFit() {
  if (keyboardCloseTimer) return;
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  fitDebounceTimer = setTimeout(() => {
    fitDebounceTimer = null;
    if (onFitCallback) onFitCallback();
  }, 100);
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
    window.addEventListener("orientationchange", () => setTimeout(updateViewportHeight, 120));

    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
      if (e.target.closest(".modal-overlay")) return;
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
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
