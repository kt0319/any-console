/**
 * 編集可能要素（input/textarea/contenteditable）かを判定する。
 * グローバル keydown リスナーがモーダル内の編集要素を妨げないためのガードに使う。
 */
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}
