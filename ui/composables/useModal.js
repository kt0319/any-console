import { ref, onUnmounted, nextTick } from "vue";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal() {
  const visible = ref(false);
  let releaseKeydown = null;
  let releaseEscape = null;

  function trapFocus(modalEl, closeFn) {
    function onKeydown(e) {
      if (e.key !== "Tab") return;
      const focusable = Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
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
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    modalEl.addEventListener("keydown", onKeydown);
    // タッチデバイスでは自動フォーカスを行わない。
    // モバイルだと最初の要素（モーダルタイトル等）にフォーカスリングが
    // 出てしまい、ユーザの意図しない見た目になる。Tab キー操作が無いので
    // 自動フォーカスのメリットも無い。
    const isTouchOnly = typeof window !== "undefined"
      && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
    if (!isTouchOnly) {
      const focusable = Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length > 0) focusable[0].focus();
    }
    return () => modalEl.removeEventListener("keydown", onKeydown);
  }

  function open(modalElOrGetter, closeFn) {
    visible.value = true;
    const onEscape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFn();
      }
    };
    document.addEventListener("keydown", onEscape, true);
    releaseEscape = () => document.removeEventListener("keydown", onEscape, true);
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
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
    nextTick(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur());
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
