import { ref, reactive } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useInputStore } from "../stores/input.js";

export const REPEAT_DELAY = 400;
export const REPEAT_INTERVAL = 80;
export const MIN_REPEAT_INTERVAL = 30;
export const REPEAT_ACCELERATION = 8;
export const LONG_PRESS_MS = 400;
const FLICK_THRESHOLD = 40;

export function useKeyboard() {
  const terminalStore = useTerminalStore();
  const inputStore = useInputStore();

  const modifierState = reactive({ ctrl: false, shift: false });

  function getActiveTerminalTab() {
    const tabs = terminalStore.openTabs;
    const id = terminalStore.activeTabId;
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.type !== "terminal") return null;
    return tab;
  }

  function keyDefToAnsi(keyDef) {
    if (keyDef.ctrl && keyDef.key.length === 1) {
      const code = keyDef.key.toLowerCase().charCodeAt(0) - 96;
      if (code > 0 && code < 27) return String.fromCharCode(code);
    }
    if (keyDef.shift && keyDef.key === "Tab") return "\x1b[Z";
    if (keyDef.shift && keyDef.key.length === 1) return keyDef.key.toUpperCase();
    const mapping = {
      Backspace: "\x7f", Enter: "\r", Tab: "\t", Escape: "\x1b",
      ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D",
      Home: "\x1b[H", End: "\x1b[F", Delete: "\x1b[3~",
      PageUp: "\x1b[5~", PageDown: "\x1b[6~", " ": " ", "/": "/",
    };
    if (mapping[keyDef.key]) return mapping[keyDef.key];
    if (keyDef.key.length === 1) return keyDef.key;
    return null;
  }

  function sendKeyToTerminal(keyDef) {
    const tab = getActiveTerminalTab();
    if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
    const seq = keyDefToAnsi(keyDef);
    if (seq) tab.ws.send(new TextEncoder().encode(seq));
  }

  function sendTextToTerminal(text) {
    const tab = getActiveTerminalTab();
    if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
    tab.ws.send(new TextEncoder().encode(text));
  }

  function scrollTerminal(direction) {
    const tab = getActiveTerminalTab();
    if (!tab || !tab.term) return;
    tab.term.scrollLines(direction === "up" ? -20 : 20);
  }

  function clearModifiers() {
    modifierState.ctrl = false;
    modifierState.shift = false;
  }

  function setupFlickRepeat(el, resolveKey, onTap, opts = {}) {
    let startX = 0, startY = 0;
    let repeatTimer = null;
    let repeatingKey = null;
    let longPressTimer = null;
    let longPressFired = false;

    const stopRepeat = () => {
      if (repeatTimer !== null) { clearTimeout(repeatTimer); repeatTimer = null; }
      repeatingKey = null;
    };
    const cancelLongPress = () => {
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    const scheduleRepeat = (key, interval) => {
      repeatTimer = setTimeout(() => {
        sendKeyToTerminal(key);
        const next = opts.accelerateRepeat
          ? Math.max(MIN_REPEAT_INTERVAL, interval - REPEAT_ACCELERATION)
          : interval;
        scheduleRepeat(key, next);
      }, interval);
    };

    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      el.classList.add("pressed");
      stopRepeat();
      longPressFired = false;
      if (opts.onLongPress && (!opts.longPressGuard || opts.longPressGuard())) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          longPressFired = true;
          el.classList.remove("pressed");
          opts.onLongPress();
        }, LONG_PRESS_MS);
      }
    }, { passive: false });

    el.addEventListener("touchmove", (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      const key = resolveKey(dx, dy, FLICK_THRESHOLD);
      cancelLongPress();
      if (!key) { stopRepeat(); return; }
      if (opts.onFlick && opts.onFlick(key, dx, dy)) { stopRepeat(); return; }
      if (repeatingKey && repeatingKey.key === key.key) return;
      stopRepeat();
      repeatingKey = key;
      sendKeyToTerminal(key);
      repeatTimer = setTimeout(() => scheduleRepeat(key, REPEAT_INTERVAL), REPEAT_DELAY);
    }, { passive: true });

    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      el.classList.remove("pressed");
      cancelLongPress();
      if (longPressFired) return;
      if (repeatingKey) { stopRepeat(); return; }
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const key = resolveKey(dx, dy, FLICK_THRESHOLD);
      if (key) {
        if (opts.onFlick && opts.onFlick(key, dx, dy)) return;
        sendKeyToTerminal(key);
      } else if (onTap) {
        onTap();
      }
    });

    el.addEventListener("touchcancel", () => {
      el.classList.remove("pressed");
      stopRepeat();
      cancelLongPress();
    });
  }

  return {
    modifierState,
    sendKeyToTerminal,
    sendTextToTerminal,
    scrollTerminal,
    clearModifiers,
    keyDefToAnsi,
    setupFlickRepeat,
    getActiveTerminalTab,
  };
}
