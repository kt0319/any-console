import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * template ref の実測幅を ResizeObserver で追跡し、reservedPx を差し引いた
 * 上限幅を返す（ピル行の幅上限計算 — TerminalPane / SessionSidebarRow で共用）。
 * template ref の watch はアンマウント時には再発火しない（scope 停止が先）ため、
 * onBeforeUnmount で明示的に解放する。
 */
export function useElementMaxWidth(elRef: Ref<HTMLElement | null>, reservedPx: number) {
  const width = ref(0);
  let ro: ResizeObserver | null = null;
  watch(elRef, (el) => {
    ro?.disconnect();
    ro = null;
    if (!el) return;
    ro = new ResizeObserver((entries) => {
      for (const e of entries) width.value = e.contentRect.width;
    });
    ro.observe(el);
  });
  onBeforeUnmount(() => {
    ro?.disconnect();
    ro = null;
  });
  const maxWidth = computed(() => Math.max(0, width.value - reservedPx));
  return { maxWidth };
}
