/**
 * グリッド分割レイアウトを計算する。
 * 各要素はそのrowに何カラム配置するかを表す。
 *
 * @param {number} count - 配置するペイン数
 * @returns {number[]}
 */
export function calcGridLayout(count) {
  if (count <= 1) return [1];
  if (count === 2) return [1, 1];
  if (count === 3) return [2, 1];
  if (count === 4) return [2, 2];
  return [3, Math.max(1, count - 3)];
}

/**
 * splitPaneTabIds から rows × cols のグリッド配列を構築する。
 *
 * @param {number[]} ids - splitPaneTabIds
 * @returns {Array<Array<{tabId:number, globalIndex:number}>>}
 */
export function buildGridRows(ids) {
  const layout = calcGridLayout(ids.length);
  const rows = [];
  let offset = 0;
  for (const cols of layout) {
    const row = [];
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
