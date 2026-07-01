/**
 * keyDef -> ANSI escape sequence へ変換する。
 * keyDef は { key: string, ctrl?: boolean, shift?: boolean } 形式。
 */
export function keyDefToAnsi(keyDef) {
  if (keyDef.ctrl && keyDef.key.length === 1) {
    const code = keyDef.key.toLowerCase().charCodeAt(0) - 96;
    if (code > 0 && code < 27) return String.fromCharCode(code);
  }
  if (keyDef.shift && keyDef.key === "Tab") return "\x1b[Z";
  if (keyDef.shift && keyDef.key === "Enter") return "\n";
  if (keyDef.shift && keyDef.key.length === 1) return keyDef.key.toUpperCase();
  const mapping = {
    Backspace: "\x7f", Enter: "\r", Tab: "\t", Escape: "\x1b",
    ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D",
    Home: "\x1b[H", End: "\x1b[F", Insert: "\x1b[2~", Delete: "\x1b[3~",
    PageUp: "\x1b[5~", PageDown: "\x1b[6~", " ": " ", "/": "/",
    F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS",
    F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~", F8: "\x1b[19~",
    F9: "\x1b[20~", F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
  };
  if (mapping[keyDef.key]) return mapping[keyDef.key];
  if (keyDef.key.length === 1) return keyDef.key;
  return null;
}
