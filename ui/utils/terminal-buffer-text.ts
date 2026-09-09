import type { Terminal } from "@xterm/xterm";

// URL 本体は非ASCII文字（全角カッコ「（）」や日本語など）でも終端する。
// URL に生の非ASCIIは入らない前提。これがないと `http://host:3900（Tailscale直）` の
// ように後続の全角テキストまで URL に飲み込まれる（日本語はスペースが無いため）。
export const TERMINAL_URL_REGEX = /(https?:\/\/[^\s)\]>'"\u0080-\uffff]+|www\.[^\s)\]>'"\u0080-\uffff]+)/g;

// URLが何行にまたがっても収まるよう、タップ行の前後を広めに束ねてから
// 正規表現でタップ位置を含む一致を探す。isWrapped（xtermの自動折返し）や
// 行末文字（アプリ側の明示的な改行）の判定に頼って連結範囲を厳密に絞る
// 方式は、判定がずれるとURLが途中で切れて返る不具合があったため、固定
// 幅の窓を束ねるだけの単純な方式に寄せる（多少無関係な行を巻き込んでも、
// 正規表現がhttps://等のプレフィックスを要求するため誤検出はしにくい）。
const URL_SEARCH_WINDOW_LINES = 6;

export function findUrlInBuffer(term: Terminal | null | undefined, clientX: number, clientY: number): string | null {
  if (!term || !term.element) return null;
  const screen = term.element.querySelector(".xterm-screen") || term.element;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // モバイル長押し確定時はスクロール/レイアウト再計算のタイミングずれで座標が
  // 矩形からわずかにはみ出すことがある。ここで null にすると WebLinksAddon 側の
  // 行をまたがない検出結果にフォールバックし、折返し URL が途中で切れて返る
  // ため、矩形内にクランプしてから判定を続ける（実バッファ範囲外の行は後段の
  // buf.getLine(lineIdx) チェックで従来通り null になる）。
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
  if (!buf.getLine(lineIdx)) return null;

  const startIdx = Math.max(0, lineIdx - URL_SEARCH_WINDOW_LINES);
  const endIdx = Math.min(buf.length - 1, lineIdx + URL_SEARCH_WINDOW_LINES);

  let text = "";
  const lineOffsets: Record<number, number> = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const cur = buf.getLine(i);
    if (!cur) break;
    // シェルの折返し表示は継続行の先頭に字下げ用の空白を入れることがある
    // （tmux配下の実ターミナルで確認済み。例: 直前行末尾を2スペースで埋め、
    // 次行の先頭にも2スペースを入れて視覚的に揃える）。末尾だけトリムして
    // 直結すると、この先頭インデントが本物の空白として残り、正規表現が
    // そこでURLを打ち切ってしまう。先頭も削り、削った分だけ lineOffsets を
    // 前倒しして col（元の生の列番号）とのズレを補正する。
    const lineText = cur.translateToString(true);
    const leadingTrimmed = lineText.trimStart();
    const strippedLeading = lineText.length - leadingTrimmed.length;
    lineOffsets[i] = text.length - strippedLeading;
    // 最終行以外は末尾スペースをトリムして継続結合する。
    text += (i < endIdx) ? leadingTrimmed.trimEnd() : leadingTrimmed;
  }

  const absPos = (lineOffsets[lineIdx] || 0) + col;
  TERMINAL_URL_REGEX.lastIndex = 0;
  let m;
  while ((m = TERMINAL_URL_REGEX.exec(text)) !== null) {
    if (absPos >= m.index && absPos < m.index + m[0].length) {
      let url = m[0];
      if (url.startsWith("www.")) url = "https://" + url;
      return url;
    }
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
