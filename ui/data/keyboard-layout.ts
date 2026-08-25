// キーレイアウト定義。flickUp/flickDown は上・下フリック時に送信する文字。

export const NUMBER_KEYS = [
  { label: "F1",  key: "F1" },
  { label: "F2",  key: "F2" },
  { label: "F3",  key: "F3" },
  { label: "F4",  key: "F4" },
  { label: "F5",  key: "F5" },
  { label: "F6",  key: "F6" },
  { label: "F7",  key: "F7" },
  { label: "F8",  key: "F8" },
  { label: "F9",  key: "F9" },
  { label: "F10", key: "F10" },
];

export const QWERTY_ROWS = [
  [
    { label: "q", key: "q", flickUp: "1", flickDown: "!" },
    { label: "w", key: "w", flickUp: "2", flickDown: "\"" },
    { label: "e", key: "e", flickUp: "3", flickDown: "#" },
    { label: "r", key: "r", flickUp: "4", flickDown: "$" },
    { label: "t", key: "t", flickUp: "5", flickDown: "%" },
    { label: "y", key: "y", flickUp: "6", flickDown: "&" },
    { label: "u", key: "u", flickUp: "7", flickDown: "@" },
    { label: "i", key: "i", flickUp: "8", flickDown: "+" },
    { label: "o", key: "o", flickUp: "9", flickDown: "-" },
    { label: "p", key: "p", flickUp: "0", flickDown: "=" },
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
    { label: "Del", key: "Delete" },
  ],
  [
    { label: "z", key: "z", flickUp: "~" },
    { label: "x", key: "x", flickUp: "|" },
    { label: "c", key: "c", flickUp: "/",  flickDown: "\\" },
    { label: "v", key: "v", flickUp: "," },
    { label: "b", key: "b", flickUp: "." },
    { label: "n", key: "n", flickUp: "?" },
    { label: "m", key: "m", flickUp: "_" },
    { label: "Camera", key: "_camera" },
  ],
];
