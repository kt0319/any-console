/**
 * 編集可能要素（input/textarea/select/contenteditable）かを判定する。
 * グローバル keydown / paste リスナーがフォーム要素を妨げないためのガードに使う。
 */
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * タップ演出（.tap-bounce）のCSSアニメーションを先頭から再生し直す。
 * クラスを外した後に reflow（offsetWidth 読み）を挟んでから付け直す
 * （挟まないと再生済みアニメーションが再始動しないため）。
 * @param {HTMLElement} el
 */
export function restartTapBounce(el) {
  el.classList.remove("tap-bounce");
  void el.offsetWidth;
  el.classList.add("tap-bounce");
}
