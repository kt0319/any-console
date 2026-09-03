/**
 * 句点・ピリオド（。．！？.!?）の直後で改行する。読点（、，）は対象外。
 * 全角句点系は直後で改行。半角の . ! ? は後ろにスペースがある文末のみ対象とし、
 * foo.txt や 3.14 のような文中ピリオドでは改行しない。
 */
export function breakAtPunctuation(text: string): string {
  return text
    .replace(/([。．！？])(?!\n)/g, "$1\n")
    .replace(/([.!?]) +/g, "$1\n");
}

export function stripLeadingSpaces(text: string): string {
  return text.replace(/^[ \t]+/gm, "");
}

/**
 * 文が途中で折り返されている改行を外して 1 行に繋ぐ。
 * 行末が文末記号（。．！？.!?:：）でなく前後の行がともに非空なら折り返しとみなす。
 * 英単語の境界（前行末・次行頭がともに半角英数）はスペースで、それ以外はそのまま繋ぐ。
 * 空行は段落区切りとして残す。
 */
export function joinWrappedLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out[out.length - 1];
    const continues = prev !== undefined && prev !== "" && line !== "" && !/[。．！？.!?:：]$/.test(prev);
    if (continues) {
      const joiner = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(line) ? " " : "";
      out[out.length - 1] = prev + joiner + line;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

export function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")    // 各行の末尾空白
    .replace(/\n{3,}/g, "\n\n")  // 3連以上の空行を2行に圧縮
    .trim();                     // 先頭・末尾の空白/空行
}

export interface FormatOptions {
  /** 行頭スペースの削除 */
  stripLeading?: boolean;
  /** 折り返し改行の結合 */
  joinWrapped?: boolean;
  /** 句読点で改行 */
  breakLines?: boolean;
  /** 余白・改行の整理 */
  tidy?: boolean;
}

/**
 * 指定されたオプションの整形のみを順に適用する。全オプション off なら原文を返す
 * （非破壊・即座に原文へ戻せる前提）。
 */
export function applyFormat(text: string, opts: FormatOptions = {}): string {
  if (!text) return text;
  let out = text;
  if (opts.stripLeading) out = stripLeadingSpaces(out);
  if (opts.joinWrapped) out = joinWrappedLines(out);
  if (opts.breakLines) out = breakAtPunctuation(out);
  if (opts.tidy) out = tidyWhitespace(out);
  return out;
}
