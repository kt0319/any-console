/**
 * tablist のロービングフォーカス（ArrowLeft/ArrowRight/Home/End）で
 * 次に選択すべきタブの index を返す。矢印キーは端で折り返す。
 * 対象外のキー・タブ0件・currentIndex が特定できない場合は null
 * （呼び出し側は何もしない）。
 * @param {string} key KeyboardEvent.key
 * @param {number} currentIndex 現在アクティブなタブの index（見つからなければ -1）
 * @param {number} length タブ数
 * @returns {number | null}
 */
export function nextTabIndex(key, currentIndex, length) {
  if (length <= 0 || currentIndex < 0) return null;
  if (key === "ArrowLeft") return (currentIndex - 1 + length) % length;
  if (key === "ArrowRight") return (currentIndex + 1) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
