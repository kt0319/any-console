/**
 * keyDef -> ANSI escape sequence へ変換する。
 * keyDef は { key: string, ctrl?: boolean, shift?: boolean, alt?: boolean } 形式。
 */

export type KeyDef = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

// CSI 最終文字形式のキー（矢印・Home・End）。修飾時は ESC[1;{mod}{letter}。
const CSI_LETTER: Record<string, string> = {
  ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D",
  Home: "H", End: "F",
};

// CSI チルダ形式のキー。修飾時は ESC[{num};{mod}~。
const CSI_TILDE: Record<string, string> = {
  Insert: "2", Delete: "3", PageUp: "5", PageDown: "6",
  F5: "15", F6: "17", F7: "18", F8: "19",
  F9: "20", F10: "21", F11: "23", F12: "24",
};

// SS3 形式のファンクションキー。未修飾は ESCO{letter}、修飾時は ESC[1;{mod}{letter}。
const SS3_FN: Record<string, string> = { F1: "P", F2: "Q", F3: "R", F4: "S" };

// xterm 準拠の修飾パラメータ: 1 + Shift(1) + Alt(2) + Ctrl(4)。1（修飾なし）は省略される。
function modifierParam(keyDef: KeyDef) {
  return 1 + (keyDef.shift ? 1 : 0) + (keyDef.alt ? 2 : 0) + (keyDef.ctrl ? 4 : 0);
}

export function keyDefToAnsi(keyDef: KeyDef) {
  // CSI/SS3 系のキーは Alt もモディファイアパラメータに畳み込む（ESC は既にシーケンス先頭にあるため
  // 二重プレフィックスにしない）。
  const mod = modifierParam(keyDef);

  if (CSI_LETTER[keyDef.key]) {
    const letter = CSI_LETTER[keyDef.key];
    return mod > 1 ? `\x1b[1;${mod}${letter}` : `\x1b[${letter}`;
  }
  if (CSI_TILDE[keyDef.key]) {
    const num = CSI_TILDE[keyDef.key];
    return mod > 1 ? `\x1b[${num};${mod}~` : `\x1b[${num}~`;
  }
  if (SS3_FN[keyDef.key]) {
    const letter = SS3_FN[keyDef.key];
    return mod > 1 ? `\x1b[1;${mod}${letter}` : `\x1bO${letter}`;
  }

  // それ以外は「Alt はキーの前に ESC を送る」という xterm の meta-sends-escape 慣習で表す。
  const altPrefix = keyDef.alt ? "\x1b" : "";

  if (keyDef.ctrl && keyDef.key.length === 1) {
    const code = keyDef.key.toLowerCase().charCodeAt(0) - 96;
    if (code > 0 && code < 27) return altPrefix + String.fromCharCode(code);
  }
  if (keyDef.shift && keyDef.key === "Tab") return altPrefix + "\x1b[Z";
  if (keyDef.shift && keyDef.key === "Enter") return altPrefix + "\n";
  if (keyDef.shift && keyDef.key.length === 1) return altPrefix + keyDef.key.toUpperCase();

  const mapping: Record<string, string> = {
    Backspace: "\x7f", Enter: "\r", Tab: "\t", Escape: "\x1b",
    " ": " ", "/": "/",
  };
  if (mapping[keyDef.key]) return altPrefix + mapping[keyDef.key];
  if (keyDef.key.length === 1) return altPrefix + keyDef.key;
  return null;
}
