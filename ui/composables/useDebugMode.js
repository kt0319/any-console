import { ref, watch } from "vue";
import { LS_KEY_DEBUG_MODE, LS_KEY_DEBUG_LEVELS, DEBUG_LEVELS } from "../utils/constants.js";

function loadMode() {
  try { return localStorage.getItem(LS_KEY_DEBUG_MODE) === "1"; } catch { return false; }
}

function loadLevels() {
  try {
    const raw = localStorage.getItem(LS_KEY_DEBUG_LEVELS);
    if (!raw) return new Set(DEBUG_LEVELS);
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : DEBUG_LEVELS);
  } catch { return new Set(DEBUG_LEVELS); }
}

const debugMode = ref(loadMode());
const debugLevels = ref(loadLevels());

watch(debugMode, (v) => {
  try {
    if (v) localStorage.setItem(LS_KEY_DEBUG_MODE, "1");
    else localStorage.removeItem(LS_KEY_DEBUG_MODE);
  } catch { /* quota — ignore */ }
});

watch(debugLevels, (v) => {
  try { localStorage.setItem(LS_KEY_DEBUG_LEVELS, JSON.stringify([...v])); } catch { /* quota — ignore */ }
}, { deep: true });

export function useDebugMode() {
  return debugMode;
}

export function useDebugLevels() {
  return debugLevels;
}
