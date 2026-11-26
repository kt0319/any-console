/** 分割ペインの空きペインID（"empty:<n>" 文字列）を扱う。splitPaneTabIds の要素は通常タブIDの数値。 */

const EMPTY_PANE_PREFIX = "empty:";

export function isEmptyPaneId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(EMPTY_PANE_PREFIX);
}

export function makeEmptyPaneId(seq: number | string): string {
  return `${EMPTY_PANE_PREFIX}${seq}`;
}

function isRealTabId(id: unknown): id is number {
  return id != null && typeof id === "number";
}

export function realTabIds(ids: Array<number | string | null | undefined> | null | undefined): number[] {
  return (ids || []).filter(isRealTabId);
}

export function countRealPanes(ids: Array<number | string | null | undefined> | null | undefined): number {
  return realTabIds(ids).length;
}
