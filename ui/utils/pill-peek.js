// モバイルで畳んだ「...」ピルの裏にある展開ボタン群のいずれかが更新された時、
// そのボタン自身を一時的に「...」の左に表示する（数秒後に隠す）ための純粋ロジック。
// 表示はルックアライクではなく実ボタンそのものを一時的に v-if するだけなので、
// ここでは変化検出に必要な最小限の値（key + 見た目に影響する text）だけを扱う。

/**
 * @param {{key: string, text: string}[]} items
 * @returns {Map<string, string>} key -> text のシグネチャ
 */
export function trailingItemsSignature(items) {
  return new Map((items || []).map((it) => [it.key, it.text]));
}

/**
 * 直前のシグネチャと比べて追加された、または内容が変わった項目を1つ返す。
 * 複数変化していれば items の並び順で最初のものを返す。変化が無ければ null。
 * @param {{key: string, text: string}[]} items
 * @param {Map<string, string>} prevSignature
 * @returns {{key: string, text: string} | null}
 */
export function findChangedTrailingItem(items, prevSignature) {
  return (items || []).find((it) => prevSignature.get(it.key) !== it.text) || null;
}
