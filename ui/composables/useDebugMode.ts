import { ref, watch } from "vue";
import { LS_KEY_DEBUG_MODE, LS_KEY_DEBUG_LEVELS, DEBUG_LEVELS } from "../utils/constants.ts";
import { safeFlagLoad, safeFlagSave, safeJsonLoad, safeJsonSave } from "../utils/storage.ts";

function loadLevels(): Set<string> {
  const parsed = safeJsonLoad(LS_KEY_DEBUG_LEVELS, null);
  return new Set<string>(Array.isArray(parsed) ? parsed : DEBUG_LEVELS);
}

const debugMode = ref<boolean>(safeFlagLoad(LS_KEY_DEBUG_MODE));
const debugLevels = ref(loadLevels());

watch(debugMode, (v) => {
  safeFlagSave(LS_KEY_DEBUG_MODE, v);
});

watch(debugLevels, (v) => {
  safeJsonSave(LS_KEY_DEBUG_LEVELS, [...v]);
}, { deep: true });

export function useDebugMode() {
  return debugMode;
}

export function useDebugLevels() {
  return debugLevels;
}
