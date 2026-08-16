type TerminalSettingMeta =
  | { type: "number", label: string, min: number, max: number, step: number, unit?: string, note?: string }
  | { type: "select", label: string, options: { value: string, label: string }[], note?: string }
  | { type: "boolean", label: string, note?: string };

export const TERMINAL_SETTINGS_META: Record<string, TerminalSettingMeta> = Object.freeze({
  fontSize: { type: "number", label: "Font Size", min: 10, max: 24, step: 1, unit: "px", note: "Applied to new terminals." },
  cursorStyle: {
    type: "select",
    label: "Cursor Style",
    options: [
      { value: "block", label: "Block" },
      { value: "underline", label: "Underline" },
      { value: "bar", label: "Bar" },
    ],
    note: "Applied to new terminals.",
  },
  cursorBlink: { type: "boolean", label: "Cursor Blink", note: "Applied to new terminals." },
  scrollback: { type: "number", label: "Scrollback", min: 1000, max: 200000, step: 1000, unit: "lines", note: "Lines of history retained. Applied to new terminals." },
  scrollOnOutput: { type: "boolean", label: "Scroll on Output", note: "Applied to new terminals." },
  copyOnSelect: { type: "boolean", label: "Copy on Select", note: "Automatically copy selected text to the clipboard. Also applies to clipboard sync from tmux (OSC 52)." },
  touchScrollSensitivity: { type: "number", label: "Touch Scroll Sensitivity", min: 0.5, max: 5, step: 0.5 },
});

export const DEFAULT_TERMINAL_SETTINGS: Record<string, string | number | boolean> = Object.freeze({
  fontSize: 12,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 100000,
  scrollOnOutput: true,
  copyOnSelect: true,
  touchScrollSensitivity: 1.5,
});

export function sanitizeTerminalSetting(key: string, value: unknown) {
  const schema = TERMINAL_SETTINGS_META[key];
  const fallback = DEFAULT_TERMINAL_SETTINGS[key];
  if (!schema) return fallback;
  // 保存値に存在しないキー（後から追加された設定）はデフォルトに倒す。
  // undefinedをfalse扱いすると、新しいboolean設定を追加するたび既存ユーザーだけ
  // デフォルトtrueのはずがオフで始まってしまう。
  if (schema.type === "boolean") {
    if (value === undefined) return fallback;
    return value === true || value === "true";
  }
  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = schema.step && schema.step >= 1 ? Math.round(num) : num;
    return Math.min(schema.max, Math.max(schema.min, rounded));
  }
  if (schema.type === "select") {
    const allowed = schema.options.map((opt) => opt.value);
    return allowed.includes(value as string) ? value : fallback;
  }
  return fallback;
}

export function sanitizeTerminalSettings(raw: unknown) {
  const source: Record<string, unknown> = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const next: Record<string, any> = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}
