import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_INPUT_HISTORY, INPUT_HISTORY_MAX } from "../utils/constants.js";
import { safeJsonLoad } from "../utils/storage.js";
import { EP_SETTINGS_KEYBOARD_LAYOUT } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";
import defaultLayout from "../data/keyboard-layout-default.json";

function normalizeFlick(key) {
  const out = { ...key };
  const flick = key.flick;
  if (flick) {
    if (flick.up !== undefined) out.flickUp = flick.up;
    if (flick.down !== undefined) out.flickDown = flick.down;
    if (flick.left !== undefined) out.flickLeft = flick.left;
    if (flick.right !== undefined) out.flickRight = flick.right;
  }
  delete out.flick;
  return out;
}

function normalizeLayout(layout) {
  const modifiers = (layout?.modifiers || []).map(normalizeFlick);
  const numberRow = (layout?.numberRow || []).map(normalizeFlick);
  const rows = (layout?.rows || []).map((row) => row.map(normalizeFlick));
  return { modifiers, numberRow, rows };
}

const INPUT_HISTORY_KEY = LS_KEY_INPUT_HISTORY;

export const useInputStore = defineStore("input", () => {
  const inputHistory = ref(safeJsonLoad(INPUT_HISTORY_KEY, []));
  const snippetsCache = ref([]);
  const isSnippetsLoaded = ref(false);

  const initial = normalizeLayout(defaultLayout);
  const QUICK_KEYS = ref(initial.modifiers);
  const NUMBER_KEYS = ref(initial.numberRow);
  const QWERTY_ROWS = ref(initial.rows);
  const isLayoutLoaded = ref(false);

  async function loadKeyboardLayout() {
    if (isLayoutLoaded.value) return;
    try {
      const auth = useAuthStore();
      const res = await auth.apiFetch(EP_SETTINGS_KEYBOARD_LAYOUT);
      if (!res || !res.ok) return;
      const layout = normalizeLayout(await res.json());
      QUICK_KEYS.value = layout.modifiers;
      NUMBER_KEYS.value = layout.numberRow;
      QWERTY_ROWS.value = layout.rows;
      isLayoutLoaded.value = true;
    } catch {
      /* keep fallback */
    }
  }

  function addInputHistory(text) {
    if (!text) return;
    if (snippetsCache.value.some((s) => s.command === text)) return;
    inputHistory.value = inputHistory.value.filter((h) => h !== text);
    inputHistory.value.unshift(text);
    if (inputHistory.value.length > INPUT_HISTORY_MAX) inputHistory.value.length = INPUT_HISTORY_MAX;
    localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory.value));
  }

  return {
    QUICK_KEYS,
    NUMBER_KEYS,
    QWERTY_ROWS,
    INPUT_HISTORY_KEY,
    INPUT_HISTORY_MAX,
    inputHistory,
    snippetsCache,
    isSnippetsLoaded,
    isLayoutLoaded,
    loadKeyboardLayout,
    addInputHistory,
  };
});
