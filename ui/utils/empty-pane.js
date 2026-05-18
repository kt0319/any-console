/**
 * 分割ペインの「空きペイン」ID（タブ未割り当て）を表す文字列を扱うユーティリティ。
 * splitPaneTabIds の要素は通常タブIDの数値だが、空きペインは "empty:<n>" 文字列で表す。
 */

const EMPTY_PANE_PREFIX = "empty:";

export function isEmptyPaneId(id) {
  return typeof id === "string" && id.startsWith(EMPTY_PANE_PREFIX);
}

export function makeEmptyPaneId(seq) {
  return `${EMPTY_PANE_PREFIX}${seq}`;
}

/**
 * 数値タブID（空きペイン文字列でもnullでもない）かを判定する型ガード。
 * @param {unknown} id
 * @returns {id is number}
 */
function isRealTabId(id) {
  return id != null && typeof id === "number";
}

/**
 * splitPaneTabIds から有効なタブIDだけを取り出す。
 * @param {Array<number|string|null|undefined>|null|undefined} ids
 * @returns {number[]}
 */
export function realTabIds(ids) {
  return (ids || []).filter(isRealTabId);
}

/**
 * ペイン配列のうち、空きペイン以外（つまり有効タブ）の数を返す。
 * @param {Array<number|string|null|undefined>|null|undefined} ids
 * @returns {number}
 */
export function countRealPanes(ids) {
  return realTabIds(ids).length;
}
