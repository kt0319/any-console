import { ref } from "vue";

const DOUBLE_TAP_MS = 300;

export function useResizeHandle(initialRatio = 0.33) {
  const topRatio = ref(initialRatio);
  let lastRatioBeforeCollapse = initialRatio;
  let lastTapTime = 0;

  function onDoubleTap() {
    if (topRatio.value >= 1.0) {
      topRatio.value = 0.0;
    } else if (topRatio.value <= 0.0) {
      topRatio.value = 1.0;
    } else {
      lastRatioBeforeCollapse = topRatio.value;
      topRatio.value = topRatio.value >= 0.5 ? 1.0 : 0.0;
    }
  }

  function onDragStart(e) {
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const container = e.target.closest(".workspace-detail");
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const startRatio = topRatio.value;
    let didMove = false;

    function onMove(ev) {
      if (ev.cancelable) ev.preventDefault();
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dy = clientY - startY;
      if (Math.abs(dy) > 3) didMove = true;
      const newRatio = startRatio + dy / containerRect.height;
      topRatio.value = Math.max(0.0, Math.min(1.0, newRatio));
    }

    function onEnd() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      if (didMove) {
        lastTapTime = 0;
        if (topRatio.value < 0.05) topRatio.value = 0.0;
        else if (topRatio.value > 0.95) topRatio.value = 1.0;
        else if (topRatio.value > 0.28 && topRatio.value < 0.38) topRatio.value = 0.33;
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
  }

  function onHandlePointerDown(e) {
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) {
      lastTapTime = 0;
      onDoubleTap();
      return;
    }
    lastTapTime = now;
    onDragStart(e);
  }

  return { topRatio, onHandlePointerDown };
}
