const QUICK_KEYS = [
  { label: "\u232B", key: "Backspace", code: "Backspace", keyCode: 8 },
  { label: "\u2190", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  { label: "\u2193", key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  { label: "\u2191", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  { label: "\u2192", key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  { label: "\u21B5", key: "Enter", code: "Enter", keyCode: 13 },
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
const EXTRA_MAIN_KEYS = [
  { label: "Del", key: "Delete", code: "Delete", keyCode: 46 },
  { label: "\u00AB", key: "Home", code: "Home", keyCode: 36 },
  { html: '<span class="mdi mdi-chevron-double-down"></span>', xtermScroll: "down" },
  { html: '<span class="mdi mdi-chevron-double-up"></span>', xtermScroll: "up" },
  { label: "\u00BB", key: "End", code: "End", keyCode: 35 },
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

const INPUT_HISTORY_KEY = "pi_console_input_history";
const INPUT_HISTORY_MAX = 20;
let inputHistory = JSON.parse(localStorage.getItem(INPUT_HISTORY_KEY) || "[]");

function addInputHistory(text) {
  if (!text) return;
  inputHistory = inputHistory.filter((h) => h !== text);
  inputHistory.unshift(text);
  if (inputHistory.length > INPUT_HISTORY_MAX) inputHistory.length = INPUT_HISTORY_MAX;
  localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory));
}

const SNIPPETS_KEY = "pi_console_snippets";

function loadSnippets() {
  const raw = localStorage.getItem(SNIPPETS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function addSnippet(command) {
  const snippets = loadSnippets();
  const label = command.length <= 20 ? command : command.slice(0, 20) + "…";
  const snippet = { label, command };
  snippets.push(snippet);
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
  return snippet;
}

function deleteSnippet(index) {
  const snippets = loadSnippets();
  if (index < 0 || index >= snippets.length) return;
  snippets.splice(index, 1);
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
}
