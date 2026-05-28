import { useTerminalStore, isLinkTapped, setLongPressActive } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { createTouchTracker } from "../utils/gesture.js";
import { findUrlInBuffer, getVisibleBufferText } from "../utils/terminal-buffer-text.js";
import { emit } from "../app-bridge.js";

const LONG_PRESS_URL_MS = 400;
const TOUCH_SCROLL_THRESHOLD_PX = 6;

export function useTerminalPaneGestures({ tab, frameEl, pillEl, isActive, paneIndex, onSelectPane }) {
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const paneTouch = createTouchTracker();

  let lastTouchPos = { x: 0, y: 0 };
  let touchMoved = false;
  let longPressTimer = null;
  let pendingUrl = null;
  let longPressHandled = false;
  let touchScrollEnabled = false;
  let touchScrollStartViewportY = 0;
  let touchScrollLineHeightPx = 16;
  let touchScrolled = false;

  function cancelLongPressTimer() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function isOnPill(target) {
    return pillEl.value && pillEl.value.contains(target);
  }

  function onTouchStart(e) {
    if (isOnPill(e.target)) return;
    paneTouch.start(e);
    setLongPressActive(false);
    const t = e.touches?.[0];
    lastTouchPos = { x: t?.clientX || 0, y: t?.clientY || 0 };
    touchMoved = false;
    pendingUrl = null;
    longPressHandled = false;
    touchScrolled = false;
    touchScrollEnabled = false;
    const term = tab.value?.term;
    if (term && frameEl.value) {
      const buf = term.buffer?.active;
      if (buf) {
        touchScrollEnabled = true;
        touchScrollStartViewportY = buf.viewportY;
        if (term.rows > 0 && frameEl.value.clientHeight > 0) {
          touchScrollLineHeightPx = frameEl.value.clientHeight / term.rows;
        }
      }
    }
    cancelLongPressTimer();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (touchMoved) return;
      const url = findUrlInBuffer(tab.value?.term, lastTouchPos.x, lastTouchPos.y);
      if (url) {
        pendingUrl = url;
        longPressHandled = true;
        if (navigator.vibrate) navigator.vibrate(40);
        emit("terminal:url", { uri: url });
        pendingUrl = null;
        return;
      }
      const text = getVisibleBufferText(tab.value?.term);
      if (text) {
        longPressHandled = true;
        if (navigator.vibrate) navigator.vibrate(40);
        emit("selection:open", { text });
      }
    }, LONG_PRESS_URL_MS);
  }

  function onTouchMove(e) {
    if (isOnPill(e.target)) return;
    const { dx, dy } = paneTouch.delta(e);
    if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
      touchMoved = true;
      pendingUrl = null;
      cancelLongPressTimer();
    }
    if (touchScrollEnabled && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > TOUCH_SCROLL_THRESHOLD_PX) {
      const term = tab.value?.term;
      const buf = term?.buffer?.active;
      if (term && buf && touchScrollLineHeightPx > 0) {
        const linesDelta = -Math.round(dy / touchScrollLineHeightPx * terminalStore.terminalSettings.touchScrollSensitivity);
        const maxViewportY = Math.max(0, buf.length - term.rows);
        const targetViewportY = Math.max(0, Math.min(maxViewportY, touchScrollStartViewportY + linesDelta));
        const diff = targetViewportY - buf.viewportY;
        if (diff !== 0) {
          term.scrollLines(diff);
          touchScrolled = true;
        }
      }
    }
  }

  function onTouchEnd(e) {
    cancelLongPressTimer();
    if (pendingUrl) return;
    if (longPressHandled) {
      longPressHandled = false;
      touchScrollEnabled = false;
      return;
    }
    if (touchScrolled) {
      touchScrollEnabled = false;
      return;
    }
    touchScrollEnabled = false;
    if (isLinkTapped()) return;
    if (isOnPill(e.target)) return;
    const { dx: deltaX, dy: deltaY } = paneTouch.delta(e);
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) return;
    if (layoutStore.isSplitMode) {
      if (!isActive.value) {
        onSelectPane?.(paneIndex.value);
      }
    }
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}
