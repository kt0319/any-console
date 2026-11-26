/** 。．！？ の直後で改行。半角 . ! ? は後ろにスペースがある文末のみ（foo.txt や 3.14 を割らない）。 */
export function breakAtPunctuation(text: string): string {
  return text
    .replace(/([。．！？])(?!\n)/g, "$1\n")
    .replace(/([.!?]) +/g, "$1\n");
}

export function stripLeadingSpaces(text: string): string {
  return text.replace(/^[ \t]+/gm, "");
}

/** 文末記号（。．！？.!?:：）で終わらない行を次行と繋ぐ。英数字境界はスペース、空行は段落区切りとして残す。 */
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
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeNewlines(text: string): string {
  return text.replace(/\r?\n/g, "");
}

export function removeSpaces(text: string): string {
  return text.replace(/[ \t]/g, "");
}

export function removeAllWhitespace(text: string): string {
  return removeSpaces(removeNewlines(text));
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

/** 有効なオプションのみ順に適用する。全 off なら原文を返す。 */
export function applyFormat(text: string, opts: FormatOptions = {}): string {
  if (!text) return text;
  let out = text;
  if (opts.stripLeading) out = stripLeadingSpaces(out);
  if (opts.joinWrapped) out = joinWrappedLines(out);
  if (opts.breakLines) out = breakAtPunctuation(out);
  if (opts.tidy) out = tidyWhitespace(out);
  return out;
}
