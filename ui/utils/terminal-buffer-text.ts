import type { IBufferLine, Terminal } from "@xterm/xterm";

// 非ASCII（全角カッコや日本語）で URL を終端する。無いと `http://host:3900（Tailscale直）` のように後続の全角テキストまで飲み込む。
export const TERMINAL_URL_REGEX = /(https?:\/\/[^\s)\]>'"\u0080-\uffff]+|www\.[^\s)\]>'"\u0080-\uffff]+)/g;

// タップ行の前後を固定幅の窓で束ねて正規表現で探す。isWrapped や行末文字で連結範囲を絞る方式は、判定ずれで URL が途中で切れたため採らない。
const URL_SEARCH_WINDOW_LINES = 6;

// 非ASCII（日本語ファイル名など）は「/」より後ろのセグメントでのみ許可する。先頭側まで許すとスペースの無い日本語文（「パスは/tmp/a.png」）を巻き込む。
// 全角句読点・全角記号と私用領域（Nerd Font のプロンプトアイコン等）は終端にする（次行頭のアイコンが連結され実在しないパスになる）。
// 実在確認はサーバ側。ここでは「/ を含む」か「拡張子がある」ものだけを候補にする。
const PATH_SEGMENT_CHARS = "\\w.~@+%\\-\\u00c0-\\u1fff\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff";
// 丸カッコは対になった「(…)」だけをパスの一部にする（app/(auth)/page.tsx、Screenshot(1).png）。「(src/a.ts)」の閉じカッコは巻き込まない。
const PATH_PAREN_GROUP = `\\([${PATH_SEGMENT_CHARS}]*\\)`;
const PATH_SEGMENT = `(?:[${PATH_SEGMENT_CHARS}]|${PATH_PAREN_GROUP})+`;
const PATH_LEADING_CHAR = `(?:[\\w.~@+%-]|${PATH_PAREN_GROUP})`;
const FILE_NAME_CHAR = `(?:[\\w@+%-]|${PATH_PAREN_GROUP})`;
export const TERMINAL_PATH_REGEX = new RegExp(
  `${PATH_LEADING_CHAR}*(?:\\/${PATH_SEGMENT})+\\/?|${FILE_NAME_CHAR}+(?:\\.${FILE_NAME_CHAR}+)*\\.[A-Za-z0-9]+`,
  "g",
);

// 絶対パス・~ 始まりの行は新しいパスの開始とみなす。無いと連続するパス出力が1つに繋がる。
const PATH_START_LINE_REGEX = /^(?:\/|~\/|[-*•]\s|\d+[.)]\s)/;

// 箇条書きの行頭記号は前の行の末尾に直結させない（URL末尾にハイフンが付くため）。
const BULLET_LINE_REGEX = /^(?:[-*•]\s|\d+[.)]\s)/;

const RELATIVE_PATH_REGEX = /^[^/~.]/;
const EXTENSION_SUFFIX_REGEX = /\.[A-Za-z0-9]+$/;

function countChar(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

export function normalizeTerminalPath(raw: string): string | null {
  let path = raw;
  while (path && ".,;:)]-".includes(path[path.length - 1])) {
    // 対になる「(」がある「)」はパスの一部（app/(auth) など）
    if (path.endsWith(")") && countChar(path, "(") >= countChar(path, ")")) break;
    path = path.slice(0, -1);
  }
  if (!path || path === "/" || path === "~") return null;
  return path;
}

export function findUrlInBuffer(term: Terminal | null | undefined, clientX: number, clientY: number): string | null {
  const raw = findMatchInBuffer(term, clientX, clientY, TERMINAL_URL_REGEX, BULLET_LINE_REGEX);
  if (!raw) return null;
  return raw.startsWith("www.") ? "https://" + raw : raw;
}

export function findPathInBuffer(term: Terminal | null | undefined, clientX: number, clientY: number): string | null {
  const raw = findMatchInBuffer(term, clientX, clientY, TERMINAL_PATH_REGEX, PATH_START_LINE_REGEX);
  if (!raw || raw.endsWith("/")) return null;
  const path = normalizeTerminalPath(raw);
  if (path && RELATIVE_PATH_REGEX.test(path) && !EXTENSION_SUFFIX_REGEX.test(path)) return null;
  return path;
}

// 全角文字は2セルだが translateToString では1文字になるため、セル列を文字列位置へ換算する。
function columnToStringIndex(line: IBufferLine, col: number): number {
  if (!line.getCell) return col;
  let idx = 0;
  for (let x = 0; x < col; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    idx += cell.getChars().length || 1;
  }
  return idx;
}

function findMatchInBuffer(term: Terminal | null | undefined, clientX: number, clientY: number, regex: RegExp, tokenStartLineRegex?: RegExp): string | null {
  if (!term || !term.element) return null;
  const screen = term.element.querySelector(".xterm-screen") || term.element;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // モバイル長押し確定時は座標が矩形からわずかにはみ出すことがある。null にすると WebLinksAddon 側の検出に落ちて折返し URL が途中で切れるため、矩形内にクランプする。
  const relX = Math.min(Math.max(clientX - rect.left, 0), rect.width - 1);
  const relY = Math.min(Math.max(clientY - rect.top, 0), rect.height - 1);
  const cols = term.cols;
  const rows = term.rows;
  if (!cols || !rows) return null;
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const col = Math.floor(relX / cellW);
  const rowOffset = Math.floor(relY / cellH);
  const buf = term.buffer.active;
  const lineIdx = buf.viewportY + rowOffset;
  const tappedLine = buf.getLine(lineIdx);
  if (!tappedLine) return null;

  const startIdx = Math.max(0, lineIdx - URL_SEARCH_WINDOW_LINES);
  const endIdx = Math.min(buf.length - 1, lineIdx + URL_SEARCH_WINDOW_LINES);

  let text = "";
  const lineOffsets: Record<number, number> = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const cur = buf.getLine(i);
    if (!cur) break;
    // tmux 配下のシェルは折返しの継続行頭に字下げ空白を入れることがあり、残すと正規表現がそこで URL を打ち切る。先頭も削り、削った分だけ lineOffsets を前倒しして col とのズレを補正する。
    const lineText = cur.translateToString(true);
    const leadingTrimmed = lineText.trimStart();
    const strippedLeading = lineText.length - leadingTrimmed.length;
    if (tokenStartLineRegex && text && tokenStartLineRegex.test(leadingTrimmed)) text += "\n";
    lineOffsets[i] = text.length - strippedLeading;
    if (i >= endIdx) {
      text += leadingTrimmed;
      continue;
    }
    const trimmed = leadingTrimmed.trimEnd();
    // 空行を0文字で直結すると別々のテキストが1つの URL に繋がる（"181" と次段落の "1462" が "1811462" になる）ため、改行で境界にする。
    text += trimmed ? trimmed : "\n";
  }

  const absPos = (lineOffsets[lineIdx] || 0) + columnToStringIndex(tappedLine, col);
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (absPos >= m.index && absPos < m.index + m[0].length) return m[0];
  }
  return null;
}

export function getFullBufferText(term: Terminal | null | undefined): string | null {
  if (!term) return null;
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    lines.push(line.translateToString(true).replace(/[\s 　]+$/, ""));
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") || null;
}
