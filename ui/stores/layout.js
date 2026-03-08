import { defineStore } from "pinia";
import { ref } from "vue";

export const useLayoutStore = defineStore("layout", () => {
  const panelBottomMediaQuery = window.matchMedia("(max-width: 768px) and (orientation: portrait)");
  const panelBottom = ref(panelBottomMediaQuery.matches);
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isPwa = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  const splitMode = ref(false);
  const splitPaneTabIds = ref([]);
  const activePaneIndex = ref(0);
  const splitLayout = ref("grid");
  const isPaneSelectedByTap = ref(false);

  return {
    panelBottomMediaQuery,
    panelBottom,
    isTouchDevice,
    isPwa,
    splitMode,
    splitPaneTabIds,
    activePaneIndex,
    splitLayout,
    isPaneSelectedByTap,
  };
});
