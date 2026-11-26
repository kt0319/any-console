import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { useKeyboard } from "./useKeyboard.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { keyDefToAnsi } from "../utils/key-ansi.ts";
import { isEditableOrDialogTarget, isEditableTarget } from "../utils/dom.ts";
import { isTouchOnly } from "../utils/keyboard.ts";
import {
  MODIFIER_KEYS,
  isComposingEvent,
  isHardwareKeyboardEvent,
} from "../utils/keyboard-event.ts";

/**
 * 物理キーボードを window レベルで監視し、入力モード外なら直接ターミナルへキーを流す。
 * input フォーカス中は動作しない（draft 蓄積を妨げない）。Shift+Space で input にフォーカスする。
 */
export function useHardwareKeyboard({ inputEl, composing }: {
  inputEl: Ref<HTMLInputElement | null>,
  composing: Ref<boolean>,
}) {
  const { sendKeyToTerminal } = useKeyboard();
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const hasHardwareKeyboard = ref(false);

  function isFocused() {
    return document.activeElement === inputEl.value;
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    // サイドバー/設定オーバーレイ表示中は流さない。Esc を preventDefault すると SessionSidebar.vue の「defaultPrevented なら閉じない」ガードで閉じられなくなる。
    if (layoutStore.isSessionSidebarOpen) return;
    if (e.code === "Space" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isFocused()) {
        e.preventDefault();
        inputEl.value?.focus();
      }
      return;
    }
    if (isFocused()) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== inputEl.value && isEditableTarget(target)) return;
    if (!isHardwareKeyboardEvent(e)) return;
    hasHardwareKeyboard.value = true;
    if (isComposingEvent(e, composing.value)) return;
    if (MODIFIER_KEYS.has(e.key)) return;
    // Cmd/Win キー併用のショートカットはブラウザ・アプリに委ねる
    if (e.metaKey) return;
    const keyDef = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey };
    const seq = keyDefToAnsi(keyDef);
    if (seq == null) return;
    e.preventDefault();
    sendKeyToTerminal(keyDef);
  }

  function onGlobalClick(e: MouseEvent) {
    if (isTouchOnly()) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 編集可能要素・ダイアログ内のクリックは xterm に戻さない
    if (isEditableOrDialogTarget(target)) return;
    const tab = terminalStore.activeTab;
    try { tab?.term?.focus(); } catch {}
  }

  onMounted(() => {
    window.addEventListener("keydown", onGlobalKeydown, true);
    document.addEventListener("click", onGlobalClick, true);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onGlobalKeydown, true);
    document.removeEventListener("click", onGlobalClick, true);
  });

  return { hasHardwareKeyboard };
}
