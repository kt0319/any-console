/**
 * 分割ペインの「空きペイン」ID（タブ未割り当て）を表す文字列を扱うユーティリティ。
 * splitPaneTabIds の要素は通常タブIDの数値だが、空きペインは "empty:<n>" 文字列で表す。
 */

const EMPTY_PANE_PREFIX = "empty:";

export function isEmptyPaneId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(EMPTY_PANE_PREFIX);
}

export function makeEmptyPaneId(seq: number | string): string {
  return `${EMPTY_PANE_PREFIX}${seq}`;
}

/**
 * 数値タブID（空きペイン文字列でもnullでもない）かを判定する型ガード。
 */
function isRealTabId(id: unknown): id is number {
  return id != null && typeof id === "number";
}

/**
 * splitPaneTabIds から有効なタブIDだけを取り出す。
 */
export function realTabIds(ids: Array<number | string | null | undefined> | null | undefined): number[] {
  return (ids || []).filter(isRealTabId);
}

/**
 * ペイン配列のうち、空きペイン以外（つまり有効タブ）の数を返す。
 */
export function countRealPanes(ids: Array<number | string | null | undefined> | null | undefined): number {
  return realTabIds(ids).length;
}
