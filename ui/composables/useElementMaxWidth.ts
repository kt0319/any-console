import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * template ref の実測幅を ResizeObserver で追跡し、reservedPx を引いた上限幅を返す。
 * ref の watch はアンマウント時に再発火しない（scope 停止が先）ため onBeforeUnmount で明示解放する。
 */
export function useElementMaxWidth(elRef: Ref<HTMLElement | null>, reservedPx: number, capToSelfHalf = false) {
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
  // ピークピルは長文を1行で出すため、狭幅では画面全幅まで伸びてしまう。上限を設ける。
  // capToSelfHalf は基準要素自体が狭い場合に自身の幅の半分を上限にする。
  const cap = computed(() => (capToSelfHalf ? width.value / 2 : window.innerWidth / 2));
  const maxWidth = computed(() => Math.max(0, Math.min(width.value - reservedPx, cap.value)));
  // 上限（cap）をかけない幅。アイコンだけのピル行のように、全部を並べたいものが使う。
  const availableWidth = computed(() => Math.max(0, width.value - reservedPx));
  return { maxWidth, availableWidth };
}
