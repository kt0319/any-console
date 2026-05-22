import { ref, watch } from "vue";
import { LS_KEY_DEBUG_MODE } from "../utils/constants.js";

function load() {
  try {
    return localStorage.getItem(LS_KEY_DEBUG_MODE) === "1";
  } catch {
    return false;
  }
}

// モジュール単一のシングルトン ref。どこから useDebugMode() しても同じ状態を共有する。
const debugMode = ref(load());

watch(debugMode, (v) => {
  try {
    if (v) localStorage.setItem(LS_KEY_DEBUG_MODE, "1");
    else localStorage.removeItem(LS_KEY_DEBUG_MODE);
  } catch { /* quota — ignore */ }
});

export function useDebugMode() {
  return debugMode;
}
