import { onBeforeUnmount, onMounted, ref } from "vue";
import { useKeyboard } from "./useKeyboard.js";
import { keyDefToAnsi } from "../utils/key-ansi.js";
import { isEditableTarget } from "../utils/dom.js";
import {
  MODIFIER_KEYS,
  isComposingEvent,
  isHardwareKeyboardEvent,
} from "../utils/keyboard-event.js";

/**
 * 物理キーボード（iPad/iPhone の外付け含む）を window レベルで監視し、
 * 入力モード外なら直接ターミナルへキーを流す composable。
 *
 * - input にフォーカスがない通常時のみ動作（draft 蓄積を妨げない）
 * - Shift+Space で input フォーカスへ切替えるショートカット
 * - 物理キー由来 (KeyboardEvent.code が有効) のときだけ反応する
 *
 * @param {{ inputEl: import("vue").Ref<HTMLInputElement | null>, composing: import("vue").Ref<boolean> }} opts
 */
export function useHardwareKeyboard({ inputEl, composing }) {
  const { sendKeyToTerminal } = useKeyboard();
  const hasHardwareKeyboard = ref(false);

  function isFocused() {
    return document.activeElement === inputEl.value;
  }

  function onGlobalKeydown(e) {
    // Shift+Space で input にフォーカス（入力モード切替ショートカット）。
    if (e.code === "Space" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isFocused()) {
        e.preventDefault();
        inputEl.value?.focus();
      }
      return;
    }
    if (isFocused()) return;
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target && target !== inputEl.value && isEditableTarget(target)) return;
    if (!isHardwareKeyboardEvent(e)) return;
    hasHardwareKeyboard.value = true;
    if (isComposingEvent(e, composing.value)) return;
    if (MODIFIER_KEYS.has(e.key)) return;
    const keyDef = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey };
    const seq = keyDefToAnsi(keyDef);
    if (seq == null) return;
    e.preventDefault();
    sendKeyToTerminal(keyDef);
  }

  onMounted(() => window.addEventListener("keydown", onGlobalKeydown, true));
  onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown, true));

  return { hasHardwareKeyboard };
}
