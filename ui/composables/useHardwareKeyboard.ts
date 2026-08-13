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
 * 物理キーボード（iPad/iPhone の外付け含む）を window レベルで監視し、
 * 入力モード外なら直接ターミナルへキーを流す composable。
 *
 * - input にフォーカスがない通常時のみ動作（draft 蓄積を妨げない）
 * - Shift+Space で input フォーカスへ切替えるショートカット
 * - 物理キー由来 (KeyboardEvent.code が有効) のときだけ反応する
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
    // セッションサイドバー（PC）/設定オーバーレイ（モバイル）表示中は
    // ターミナルへ流さない。特に Esc はここで preventDefault してしまうと、
    // SessionSidebar.vue 側の「defaultPrevented なら閉じない」ガード
    // （確認ダイアログ等との衝突回避用）に弾かれ、Esc で閉じられなくなる。
    if (layoutStore.isSessionSidebarOpen) return;
    // Shift+Space で input にフォーカス（入力モード切替ショートカット）。
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
