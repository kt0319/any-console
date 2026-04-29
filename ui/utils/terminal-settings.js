export const TERMINAL_SETTINGS_META = Object.freeze({
  fontSize: { type: "number", label: "Font Size", min: 10, max: 24, step: 1, unit: "px", note: "Applied to new terminals." },
  cursorBlink: { type: "boolean", label: "Cursor Blink", note: "Applied to new terminals." },
  scrollback: { type: "number", label: "Scrollback", min: 1000, max: 20000, step: 500, unit: "lines", note: "Applied to new terminals." },
  scrollOnOutput: { type: "boolean", label: "Scroll on Output", note: "Applied to new terminals." },
});

export const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  fontSize: 12,
  cursorBlink: true,
  scrollback: 5000,
  scrollOnOutput: true,
});

export function sanitizeTerminalSetting(key, value) {
  const schema = TERMINAL_SETTINGS_META[key];
  const fallback = DEFAULT_TERMINAL_SETTINGS[key];
  if (!schema) return fallback;
  if (schema.type === "boolean") return value === true || value === "true";
  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = schema.step && schema.step >= 1 ? Math.round(num) : num;
    return Math.min(schema.max, Math.max(schema.min, rounded));
  }
  return fallback;
}

export function sanitizeTerminalSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}
