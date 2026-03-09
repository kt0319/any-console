import { ref, onUnmounted, nextTick } from "vue";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModal() {
  const visible = ref(false);
  let releaseKeydown = null;

  function trapFocus(modalEl, closeFn) {
    function onKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFn();
        return;
      }
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
    const focusable = Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusable.length > 0) focusable[0].focus();
    return () => modalEl.removeEventListener("keydown", onKeydown);
  }

  function open(modalEl, closeFn) {
    visible.value = true;
    nextTick(() => {
      if (modalEl) {
        releaseKeydown = trapFocus(modalEl, closeFn);
      }
    });
  }

  function close() {
    visible.value = false;
    if (releaseKeydown) {
      releaseKeydown();
      releaseKeydown = null;
    }
    document.activeElement?.blur();
    nextTick(() => document.activeElement?.blur());
  }

  onUnmounted(() => {
    if (releaseKeydown) {
      releaseKeydown();
      releaseKeydown = null;
    }
  });

  return { visible, open, close, trapFocus };
}
