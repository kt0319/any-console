import { ref, onMounted, onBeforeUnmount } from "vue";
import { MOBILE_BREAKPOINT_PX } from "../utils/constants.ts";

export function useIsMobile() {
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
  const isMobile = ref(mobileQuery.matches);
  function onChange(e) { isMobile.value = e.matches; }

  onMounted(() => mobileQuery.addEventListener("change", onChange));
  onBeforeUnmount(() => mobileQuery.removeEventListener("change", onChange));

  return { isMobile };
}
