// モバイルで畳んだ「...」ピルの中身が更新された時、その変化した項目を一時的に
// アイコン+テキストで見せる（数秒後に「...」へ戻す）ための純粋ロジック。

/**
 * @param {{key: string, icon: string, text: string}[]} items
 * @returns {Map<string, string>} key -> "icon|text" のシグネチャ
 */
export function trailingItemsSignature(items) {
  return new Map((items || []).map((it) => [it.key, `${it.icon}|${it.text}`]));
}

/**
 * 直前のシグネチャと比べて追加された、または内容が変わった項目を1つ返す。
 * 複数変化していれば items の並び順で最初のものを返す。変化が無ければ null。
 * @param {{key: string, icon: string, text: string}[]} items
 * @param {Map<string, string>} prevSignature
 * @returns {{key: string, icon: string, text: string} | null}
 */
export function findChangedTrailingItem(items, prevSignature) {
  return (items || []).find((it) => prevSignature.get(it.key) !== `${it.icon}|${it.text}`) || null;
}
