import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_INPUT_HISTORY, INPUT_HISTORY_MAX } from "../utils/constants.js";

const QUICK_KEYS = [
  { label: "Tab", key: "Tab", code: "Tab", keyCode: 9 },
  { label: "Ctrl", key: "Control", code: "ControlLeft", keyCode: 17, modifier: "ctrl" },
  { label: "Esc", key: "Escape", code: "Escape", keyCode: 27 },
];

const NUMBER_KEYS = [
  { label: "1", key: "1", code: "Digit1", keyCode: 49 },
  { label: "2", key: "2", code: "Digit2", keyCode: 50 },
  { label: "3", key: "3", code: "Digit3", keyCode: 51 },
  { label: "4", key: "4", code: "Digit4", keyCode: 52 },
  { label: "5", key: "5", code: "Digit5", keyCode: 53 },
  { label: "6", key: "6", code: "Digit6", keyCode: 54 },
  { label: "7", key: "7", code: "Digit7", keyCode: 55 },
  { label: "8", key: "8", code: "Digit8", keyCode: 56 },
  { label: "9", key: "9", code: "Digit9", keyCode: 57 },
  { label: "0", key: "0", code: "Digit0", keyCode: 48 },
];

const QWERTY_ROWS = [
  "qwertyuiop".split("").map((c, i) => {
    const flickDown = ["!", '"', "#", "$", "%", "&", "@", "+", "-", "="][i];
    return { label: c, key: c, flickDown };
  }),
  "asdfghjkl".split("").map((c, i) => {
    const flickUp = ["`", "'", "*", "^", "[", "]", "(", ")", ":"][i];
    const flickDownMap = { g: "{", h: "}", j: "<", k: ">", l: ";" };
    return { label: c, key: c, flickUp, ...(flickDownMap[c] ? { flickDown: flickDownMap[c] } : {}) };
  }),
  "zxcvbnm".split("").map((c, i) => {
    const flickUp = ["~", "|", "/", ",", ".", "?", "_"][i];
    const flickDownMap = { c: "\\" };
    return { label: c, key: c, flickUp, ...(flickDownMap[c] ? { flickDown: flickDownMap[c] } : {}) };
  }),
];

const INPUT_HISTORY_KEY = LS_KEY_INPUT_HISTORY;

export const useInputStore = defineStore("input", () => {
  const inputHistory = ref(JSON.parse(localStorage.getItem(INPUT_HISTORY_KEY) || "[]"));
  const snippetsCache = ref([]);
  const isSnippetsLoaded = ref(false);

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
    addInputHistory,
  };
});
