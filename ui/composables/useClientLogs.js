import { ref, watch } from "vue";
import { useDebugMode } from "./useDebugMode.js";

const MAX_LOGS = 100;
const LEVELS = ["log", "info", "warn", "error"];

const logs = ref([]);
let installed = false;
let originals = null;

function levelLabel(l) {
  return { log: "LOG", info: "INF", warn: "WRN", error: "ERR" }[l] || l.toUpperCase();
}

function formatArg(arg) {
  if (arg == null) return String(arg);
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function install() {
  if (installed) return;
  installed = true;
  originals = {};
  for (const level of LEVELS) {
    originals[level] = console[level];
    console[level] = (...args) => {
      originals[level].apply(console, args);
      logs.value.push({
        level,
        time: Date.now(),
        msg: args.map(formatArg).join(" ").slice(0, 500),
      });
      if (logs.value.length > MAX_LOGS) logs.value.shift();
    };
  }
}

function uninstall() {
  if (!installed || !originals) return;
  for (const level of LEVELS) {
    console[level] = originals[level];
  }
  installed = false;
  originals = null;
}

const debugMode = useDebugMode();
watch(debugMode, (on) => {
  if (on) install();
  else uninstall();
}, { immediate: true });

export function useClientLogs() {
  return { logs, levelLabel };
}

// デバッグモード ON のときだけ console.log を呼ぶヘルパー。
// useClientLogs が console.log をフックしているので、UI のデバッグ行にも流れる。
export function debugLog(...args) {
  if (debugMode.value) console.log(...args);
}
