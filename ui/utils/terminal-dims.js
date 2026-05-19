import { safeJsonLoad } from "./storage.js";
import { LS_KEY_TERMINAL_DIMS } from "./constants.js";

function viewportKey() {
  return `${window.innerWidth}x${window.innerHeight}`;
}

export function loadInitialDims() {
  const store = safeJsonLoad(LS_KEY_TERMINAL_DIMS, null);
  if (!store || typeof store !== "object") return null;
  const entry = store[viewportKey()];
  if (!entry || !Number.isInteger(entry.cols) || !Number.isInteger(entry.rows)) return null;
  if (entry.cols < 2 || entry.rows < 2) return null;
  return { cols: entry.cols, rows: entry.rows };
}

export function saveLastDims(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
  if (cols < 2 || rows < 2) return;
  const store = safeJsonLoad(LS_KEY_TERMINAL_DIMS, null) || {};
  store[viewportKey()] = { cols, rows };
  try {
    localStorage.setItem(LS_KEY_TERMINAL_DIMS, JSON.stringify(store));
  } catch { /* ignore quota errors */ }
}
