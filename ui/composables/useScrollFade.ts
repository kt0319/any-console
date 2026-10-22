import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { scrollFadeMaskImage } from "../utils/scroll-fade.ts";
import { SCROLL_FADE_WIDTH_PX } from "../utils/constants.ts";

// 横スクロール可能な行の端に、隠れている項目があることをフェードで示す。
// スクロール・コンテナ幅の変化・子要素の増減のいずれでも再計算する。
export function useScrollFade(el: Ref<HTMLElement | null>) {
  const canScrollLeft = ref(false);
  const canScrollRight = ref(false);

  function updateScrollFade() {
    const node = el.value;
    canScrollLeft.value = !!node && node.scrollLeft > 0;
    canScrollRight.value = !!node && node.scrollLeft < node.scrollWidth - node.clientWidth - 1;
  }

  const fadeStyle = computed(() => {
    const mask = scrollFadeMaskImage(canScrollLeft.value, canScrollRight.value, SCROLL_FADE_WIDTH_PX);
    return { maskImage: mask, webkitMaskImage: mask };
  });

  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  function disconnect() {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
  }

  watch(el, (node) => {
    disconnect();
    if (!node) {
      updateScrollFade();
      return;
    }
    resizeObserver = new ResizeObserver(updateScrollFade);
    resizeObserver.observe(node);
    mutationObserver = new MutationObserver(updateScrollFade);
    mutationObserver.observe(node, { childList: true, subtree: true });
    updateScrollFade();
  }, { immediate: true, flush: "post" });

  onBeforeUnmount(disconnect);

  return { fadeStyle, updateScrollFade };
}
