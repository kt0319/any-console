import { ref } from "vue";

export function useSwipeDismiss(targetRef, onDismiss, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 80;
  const startY = ref(0);
  const currentY = ref(0);
  const dragging = ref(false);

  function resetStyle() {
    const el = targetRef.value;
    if (!el) return;
    el.style.transform = "";
    el.style.opacity = "";
    el.style.transition = "";
  }

  function onStart(e) {
    const el = targetRef.value;
    if (!el) return;
    startY.value = e.touches[0].clientY;
    currentY.value = startY.value;
    dragging.value = true;
    el.style.transition = "none";
  }

  function onMove(e) {
    const el = targetRef.value;
    if (!dragging.value || !el) return;
    if (e.cancelable) e.preventDefault();
    currentY.value = e.touches[0].clientY;
    const dy = currentY.value - startY.value;
    el.style.transform = `translateY(${dy}px)`;
    el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dy) / 400));
  }

  function onEnd() {
    const el = targetRef.value;
    if (!dragging.value || !el) return;
    dragging.value = false;
    const dy = currentY.value - startY.value;
    if (Math.abs(dy) > threshold) {
      const endY = dy >= 0 ? "100%" : "-100%";
      el.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      el.style.transform = `translateY(${endY})`;
      el.style.opacity = "0";
      el.addEventListener("transitionend", () => {
        resetStyle();
        onDismiss?.();
      }, { once: true });
      return;
    }
    el.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
    el.style.transform = "";
    el.style.opacity = "";
    el.addEventListener("transitionend", () => {
      if (!targetRef.value) return;
      targetRef.value.style.transition = "";
    }, { once: true });
  }

  function onCancel() {
    if (!dragging.value) return;
    dragging.value = false;
    resetStyle();
  }

  return {
    resetStyle,
    onStart,
    onMove,
    onEnd,
    onCancel,
  };
}
