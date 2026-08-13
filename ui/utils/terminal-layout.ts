/**
 * グリッド分割レイアウトを計算する。
 * 各要素はそのrowに何カラム配置するかを表す。
 *
 * @param count 配置するペイン数
 */
export function calcGridLayout(count: number): number[] {
  if (count <= 1) return [1];
  if (count === 2) return [1, 1];
  if (count === 3) return [2, 1];
  if (count === 4) return [2, 2];
  return [3, Math.max(1, count - 3)];
}

/**
 * splitPaneTabIds から rows × cols のグリッド配列を構築する。
 *
 * @param ids splitPaneTabIds
 */
export function buildGridRows(ids: (number | string)[]): Array<Array<{ tabId: number | string; globalIndex: number }>> {
  const layout = calcGridLayout(ids.length);
  const rows: Array<Array<{ tabId: number | string; globalIndex: number }>> = [];
  let offset = 0;
  for (const cols of layout) {
    const row: Array<{ tabId: number | string; globalIndex: number }> = [];
    for (let c = 0; c < cols; c++) {
      const globalIndex = offset + c;
      if (globalIndex < ids.length) {
        row.push({ tabId: ids[globalIndex], globalIndex });
      }
    }
    rows.push(row);
    offset += cols;
  }
  return rows;
}
