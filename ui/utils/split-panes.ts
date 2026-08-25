// 分割ペインの純粋な index 計算（stores/layout.ts から抽出。
// terminal-layout.ts / empty-pane.ts と同じく状態を持たないためテスト可能）。

import { calcGridLayout } from "./terminal-layout.ts";
import { isEmptyPaneId, realTabIds } from "./empty-pane.ts";

/** グリッドレイアウト上で四隅 corner に対応するペイン index を返す。 */
export function cornerToGridIndex(count: number, corner: string): number {
  const rows = calcGridLayout(count);
  const topCols = rows[0] || 1;
  const bottomRow = rows.length - 1;
  const bottomCols = rows[bottomRow] || 1;
  let rowIdx = 0;
  let colIdx = 0;

  if (corner === "top-right") {
    rowIdx = 0;
    colIdx = Math.max(0, topCols - 1);
  } else if (corner === "bottom-left") {
    rowIdx = bottomRow;
    colIdx = 0;
  } else if (corner === "bottom-right") {
    rowIdx = bottomRow;
    colIdx = Math.max(0, bottomCols - 1);
  }

  let offset = 0;
  for (let i = 0; i < rowIdx; i++) offset += rows[i];
  return offset + colIdx;
}

/**
 * 新規に空きペインを作る時、割り当てられる候補タブが1つしか無いなら選ばせる
 * までもないため、そのタブを返す（無ければ null ＝これまで通り空きペインにする）。
 * 空きペイン側に一覧を出してからユーザー操作で選ばせる方式（reactive な
 * watch 等）だと、SplitEmptyPane.vue のマイナスボタン（ペインを明示的に
 * 空ける操作）でも「候補が1つだけ」の状態が再現され、外したタブ自身が
 * 即座に再割り当てされて選択画面に戻れなくなる不具合があった。生成時点
 * だけで判定するこの方式ならその副作用が起きない。
 */
export function soleRemainingTab<T extends { id: number | string }>(
  openTabs: T[] | null | undefined,
  excludeIds: (number | string)[],
): T | null {
  const exclude = new Set(excludeIds);
  const candidates = (openTabs || []).filter((t) => !exclude.has(t.id));
  return candidates.length === 1 ? candidates[0] : null;
}

/** paneCount 個の空きペインを作り、targetIdx（クランプ済み）へ tabId を置く。 */
export function buildPanesWithTabAt(
  tabId: number,
  paneCount: number,
  targetIdx: number,
  nextEmptyId: () => string,
): (number | string)[] {
  const arr: (number | string)[] = new Array(paneCount).fill(null).map(() => nextEmptyId());
  const idx = Math.min(Math.max(0, targetIdx), paneCount - 1);
  arr[idx] = tabId;
  return arr;
}

/**
 * 分割解除時の復帰先タブを決める（targetTabId → アクティブペインの実タブ →
 * ペイン内の最初の実タブ、の順にフォールバック。実タブが無ければ null）。
 */
export function resolveExitRestoreTab(
  ids: (number | string)[],
  activePaneIndex: number,
  targetTabId?: number | null,
): number | null {
  const activeId = ids[activePaneIndex];
  return targetTabId
    ?? (activeId != null && !isEmptyPaneId(activeId) ? (activeId as number) : null)
    ?? realTabIds(ids)[0]
    ?? null;
}
