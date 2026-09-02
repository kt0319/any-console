import { ref, watch } from "vue";
import { LS_KEY_LAYOUT_PREFS } from "../utils/constants.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";
import { normalizeLayoutPrefs, type LayoutPrefs } from "../utils/layout-prefs.ts";

const layoutPrefs = ref<LayoutPrefs>(normalizeLayoutPrefs(safeJsonLoad(LS_KEY_LAYOUT_PREFS, null)));

watch(layoutPrefs, (v) => {
  safeJsonSave(LS_KEY_LAYOUT_PREFS, v);
}, { deep: true });

export function useLayoutPrefs() {
  return layoutPrefs;
}
