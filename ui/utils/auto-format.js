// @ts-check

/**
 * 句点・ピリオド（。．！？.!?）の直後で改行する。読点（、，）は対象外。
 * 全角句点系は直後で改行。半角の . ! ? は後ろにスペースがある文末のみ対象とし、
 * foo.txt や 3.14 のような文中ピリオドでは改行しない。
 * @param {string} text
 * @returns {string}
 */
export function breakAtPunctuation(text) {
  return text
    .replace(/([。．！？])(?!\n)/g, "$1\n")
    .replace(/([.!?]) +/g, "$1\n");
}

/**
 * 各行の先頭の空白（インデント）を削除する。
 * @param {string} text
 * @returns {string}
 */
export function stripLeadingSpaces(text) {
  return text.replace(/^[ \t]+/gm, "");
}

/**
 * 文が途中で折り返されている改行を外して 1 行に繋ぐ。
 * 行末が文末記号（。．！？.!?:：）でなく前後の行がともに非空なら折り返しとみなす。
 * 英単語の境界（前行末・次行頭がともに半角英数）はスペースで、それ以外はそのまま繋ぐ。
 * 空行は段落区切りとして残す。
 * @param {string} text
 * @returns {string}
 */
export function joinWrappedLines(text) {
  /** @type {string[]} */
  const out = [];
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

/**
 * 行末空白の除去・連続空行の圧縮・前後の空白/空行除去でテキストを整える。
 * @param {string} text
 * @returns {string}
 */
export function tidyWhitespace(text) {
  return text
    .replace(/[ \t]+$/gm, "")    // 各行の末尾空白
    .replace(/\n{3,}/g, "\n\n")  // 3連以上の空行を2行に圧縮
    .trim();                     // 先頭・末尾の空白/空行
}

/**
 * @typedef {Object} FormatOptions
 * @property {boolean} [stripLeading] 行頭スペースの削除
 * @property {boolean} [joinWrapped]  折り返し改行の結合
 * @property {boolean} [breakLines]   句読点で改行
 * @property {boolean} [tidy]         余白・改行の整理
 */

/**
 * 指定されたオプションの整形のみを順に適用する。全オプション off なら原文を返す
 * （非破壊・即座に原文へ戻せる前提）。
 * @param {string} text
 * @param {FormatOptions} [opts]
 * @returns {string}
 */
export function applyFormat(text, opts = {}) {
  if (!text) return text;
  let out = text;
  if (opts.stripLeading) out = stripLeadingSpaces(out);
  if (opts.joinWrapped) out = joinWrappedLines(out);
  if (opts.breakLines) out = breakAtPunctuation(out);
  if (opts.tidy) out = tidyWhitespace(out);
  return out;
}
