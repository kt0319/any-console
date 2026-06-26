// アイコンピッカーのグリッド表示ロジック（純粋関数）。
// DOM 描画から分離してテスト可能にする。

/**
 * 検索クエリで MDI アイコン名を絞り込む。空クエリならそのまま返す。
 * @param {string[]} icons
 * @param {string} query
 * @returns {string[]}
 */
export function filterIcons(icons, query) {
  if (!query) return icons;
  return icons.filter((name) => name.includes(query));
}

/**
 * グリッド描画用のモデルを組み立てる。表示数を maxDisplay で打ち切り、
 * 残件数（「and N more...」表示用）を算出する。
 * @param {string[]} icons
 * @param {string} query
 * @param {number} maxDisplay
 * @returns {{ items: string[], remaining: number }}
 */
export function buildIconGridModel(icons, query, maxDisplay) {
  const filtered = filterIcons(icons, query);
  const items = filtered.slice(0, maxDisplay);
  return {
    items,
    remaining: Math.max(0, filtered.length - maxDisplay),
  };
}
