import { ref, onMounted, onBeforeUnmount } from "vue";
import { MOBILE_BREAKPOINT_PX } from "../utils/constants.ts";

export function useIsMobile() {
  // 境界は「モバイル = MOBILE_BREAKPOINT_PX 以下」で統一する（layout.ts の
  // isPanelBottom / CSS の @media (min-width: 769px) と同じ規則。以前はここ
  // だけ -1px で、ちょうど境界幅の端末で isPanelBottom と食い違っていた）。
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const isMobile = ref(mobileQuery.matches);
  function onChange(e: MediaQueryListEvent) { isMobile.value = e.matches; }

  onMounted(() => mobileQuery.addEventListener("change", onChange));
  onBeforeUnmount(() => mobileQuery.removeEventListener("change", onChange));

  return { isMobile };
}
