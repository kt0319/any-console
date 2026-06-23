import {
  LONG_PRESS_MS, FLICK_THRESHOLD,
  REPEAT_DELAY, REPEAT_INTERVAL, MIN_REPEAT_INTERVAL, REPEAT_ACCELERATION,
} from "../utils/constants.js";

/**
 * フリック式キーボードのキー要素にタッチ/クリックハンドラを attach する。
 *
 * - 軽いフリック: resolveKey(dx, dy) で得たキーを送信
 * - 同方向の指を保ち続けるとリピート（accelerateRepeat オプションで加速）
 * - 一定時間長押し: opts.onLongPress を発火
 * - フリックなしで離す: onTap
 * - PC のクリックも onTap で発火（合成クリック抑止つき）
 *
 * @param {HTMLElement} el
 * @param {(dx: number, dy: number, threshold: number) => ({key: string} | null)} resolveKey
 * @param {(keyDef: { key: string }) => void} sendKey
 * @param {(() => void) | null} [onTap]
 * @param {{
 *   accelerateRepeat?: boolean,
 *   onLongPress?: () => void,
 *   longPressGuard?: () => boolean,
 *   onFlick?: (key: { key: string }, dx: number, dy: number) => boolean,
 * }} [opts]
 */
export function attachFlickKey(el, resolveKey, sendKey, onTap = null, opts = {}) {
  let startX = 0, startY = 0;
  let repeatTimer = null;
  let repeatingKey = null;
  let longPressTimer = null;
  let longPressFired = false;
  let lastTouchTimestamp = 0;

  const stopRepeat = () => {
    if (repeatTimer !== null) { clearTimeout(repeatTimer); repeatTimer = null; }
    repeatingKey = null;
  };
  const cancelLongPress = () => {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  };
  const scheduleRepeat = (key, interval) => {
    repeatTimer = setTimeout(() => {
      sendKey(key);
      const next = opts.accelerateRepeat
        ? Math.max(MIN_REPEAT_INTERVAL, interval - REPEAT_ACCELERATION)
        : interval;
      scheduleRepeat(key, next);
    }, interval);
  };

  el.addEventListener("touchstart", (e) => {
    if (e.cancelable) e.preventDefault();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    el.classList.add("pressed");
    stopRepeat();
    longPressFired = false;
    const onLongPress = opts.onLongPress;
    if (onLongPress && (!opts.longPressGuard || opts.longPressGuard())) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        el.classList.remove("pressed");
        onLongPress();
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
    sendKey(key);
    repeatTimer = setTimeout(() => scheduleRepeat(key, REPEAT_INTERVAL), REPEAT_DELAY);
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    if (e.cancelable) e.preventDefault();
    el.classList.remove("pressed");
    cancelLongPress();
    lastTouchTimestamp = Date.now();
    if (longPressFired) return;
    if (repeatingKey) { stopRepeat(); return; }
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const key = resolveKey(dx, dy, FLICK_THRESHOLD);
    if (key) {
      if (opts.onFlick && opts.onFlick(key, dx, dy)) return;
      sendKey(key);
    } else if (onTap) {
      onTap();
    }
  });

  el.addEventListener("touchcancel", () => {
    el.classList.remove("pressed");
    stopRepeat();
    cancelLongPress();
    lastTouchTimestamp = Date.now();
  });

  // マウス（PC）クリック対応。タッチ直後の合成クリックは無視する。
  el.addEventListener("click", () => {
    if (Date.now() - lastTouchTimestamp < 500) return;
    if (onTap) onTap();
  });
}
