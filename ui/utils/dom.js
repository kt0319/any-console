/**
 * 編集可能要素（input/textarea/select/contenteditable）かを判定する。
 * グローバル keydown / paste リスナーがフォーム要素を妨げないためのガードに使う。
 */
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}
