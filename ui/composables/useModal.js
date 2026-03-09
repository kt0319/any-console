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

  function setupSwipeClose(modalEl, closeFn) {
    const handle = document.createElement("div");
    handle.className = "modal-swipe-handle";
    handle.innerHTML = '<span class="modal-swipe-bar"></span>';
    modalEl.appendChild(handle);

    const THRESHOLD = 80;
    let startY = 0;
    let currentY = 0;
    let dragging = false;

    handle.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
      currentY = startY;
      dragging = true;
      modalEl.style.transition = "none";
    }, { passive: true });

    handle.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      const dy = startY - currentY;
      if (dy > 0) {
        modalEl.style.transform = `translateY(-${dy}px)`;
        modalEl.style.opacity = Math.max(0.2, 1 - dy / 400);
      }
    }, { passive: true });

    handle.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      const dy = startY - currentY;
      if (dy > THRESHOLD) {
        modalEl.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
        modalEl.style.transform = "translateY(-100%)";
        modalEl.style.opacity = "0";
        modalEl.addEventListener("transitionend", () => {
          modalEl.style.transform = "";
          modalEl.style.opacity = "";
          modalEl.style.transition = "";
          closeFn();
        }, { once: true });
      } else {
        modalEl.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
        modalEl.style.transform = "";
        modalEl.style.opacity = "";
        modalEl.addEventListener("transitionend", () => {
          modalEl.style.transition = "";
        }, { once: true });
      }
    });
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
  }

  onUnmounted(() => {
    if (releaseKeydown) {
      releaseKeydown();
      releaseKeydown = null;
    }
  });

  return { visible, open, close, trapFocus, setupSwipeClose };
}
