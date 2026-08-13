import { ref, onUnmounted, nextTick } from "vue";
import { isTouchOnly, listenForEscape } from "../utils/keyboard.ts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(modalEl: HTMLElement): HTMLElement[] {
  return Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle?.(el);
    return style?.display !== "none" && style?.visibility !== "hidden";
  });
}

export function focusFirstFocusable(modalEl: HTMLElement) {
  const focusable = getFocusableElements(modalEl);
  if (focusable.length > 0) focusable[0].focus();
}

export function trapFocusWithin(modalEl: HTMLElement) {
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = getFocusableElements(modalEl);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  modalEl.addEventListener("keydown", onKeydown);
  return () => modalEl.removeEventListener("keydown", onKeydown);
}

export function useModal() {
  const visible = ref(false);
  let releaseKeydown: (() => void) | null = null;
  let releaseEscape: (() => void) | null = null;

  function trapFocus(modalEl: HTMLElement, closeFn?: () => void) {
    const release = trapFocusWithin(modalEl);
    // タッチデバイスでは自動フォーカスを行わない。
    // モバイルだと最初の要素（モーダルタイトル等）にフォーカスリングが
    // 出てしまい、ユーザの意図しない見た目になる。Tab キー操作が無いので
    // 自動フォーカスのメリットも無い。
    if (!isTouchOnly()) {
      focusFirstFocusable(modalEl);
    }
    return release;
  }

  function open(
    modalElOrGetter: HTMLElement | null | undefined | (() => HTMLElement | null | undefined),
    closeFn: () => void,
  ) {
    visible.value = true;
    releaseEscape = listenForEscape(closeFn);
    nextTick(() => {
      const el = typeof modalElOrGetter === "function" ? modalElOrGetter() : modalElOrGetter;
      if (el) {
        releaseKeydown = trapFocus(el, closeFn);
      }
    });
  }

  function close() {
    visible.value = false;
    if (releaseEscape) {
      releaseEscape();
      releaseEscape = null;
    }
    if (releaseKeydown) {
      releaseKeydown();
      releaseKeydown = null;
    }
    (document.activeElement as HTMLElement | null)?.blur();
    nextTick(() => (document.activeElement as HTMLElement | null)?.blur());
  }

  onUnmounted(() => {
    if (releaseEscape) {
      releaseEscape();
      releaseEscape = null;
    }
    if (releaseKeydown) {
      releaseKeydown();
      releaseKeydown = null;
    }
  });

  return { visible, open, close, trapFocus };
}
