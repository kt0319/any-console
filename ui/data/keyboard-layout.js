// キーレイアウト定義。flickUp/flickDown は上・下フリック時に送信する文字。

export const MODIFIER_KEYS = [
  { label: "Tab",  key: "Tab",     code: "Tab",         keyCode: 9  },
  { label: "Ctrl", key: "Control", code: "ControlLeft",  keyCode: 17, modifier: "ctrl" },
  { label: "Esc",  key: "Escape",  code: "Escape",       keyCode: 27 },
];

export const NUMBER_KEYS = [
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

export const QWERTY_ROWS = [
  [
    { label: "q", key: "q", flickUp: "!" },
    { label: "w", key: "w", flickUp: "\"" },
    { label: "e", key: "e", flickUp: "#" },
    { label: "r", key: "r", flickUp: "$" },
    { label: "t", key: "t", flickUp: "%" },
    { label: "y", key: "y", flickUp: "&" },
    { label: "u", key: "u", flickUp: "@" },
    { label: "i", key: "i", flickUp: "+" },
    { label: "o", key: "o", flickUp: "-" },
    { label: "p", key: "p", flickUp: "=" },
  ],
  [
    { label: "a", key: "a", flickUp: "`" },
    { label: "s", key: "s", flickUp: "'" },
    { label: "d", key: "d", flickUp: "*" },
    { label: "f", key: "f", flickUp: "^" },
    { label: "g", key: "g", flickUp: "[",  flickDown: "{" },
    { label: "h", key: "h", flickUp: "]",  flickDown: "}" },
    { label: "j", key: "j", flickUp: "(",  flickDown: "<" },
    { label: "k", key: "k", flickUp: ")",  flickDown: ">" },
    { label: "l", key: "l", flickUp: ":",  flickDown: ";" },
  ],
  [
    { label: "z", key: "z", flickUp: "~" },
    { label: "x", key: "x", flickUp: "|" },
    { label: "c", key: "c", flickUp: "/",  flickDown: "\\" },
    { label: "v", key: "v", flickUp: "," },
    { label: "b", key: "b", flickUp: "." },
    { label: "n", key: "n", flickUp: "?" },
    { label: "m", key: "m", flickUp: "_" },
  ],
];
