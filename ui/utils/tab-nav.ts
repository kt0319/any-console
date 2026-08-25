/**
 * tablist のロービングフォーカス（ArrowLeft/ArrowRight/Home/End）で
 * 次に選択すべきタブの index を返す。矢印キーは端で折り返す。
 * 対象外のキー・タブ0件・currentIndex が特定できない場合は null
 * （呼び出し側は何もしない）。
 * @param key KeyboardEvent.key
 * @param currentIndex 現在アクティブなタブの index（見つからなければ -1）
 * @param length タブ数
 */
export function nextTabIndex(key: string, currentIndex: number, length: number): number | null {
  if (length <= 0 || currentIndex < 0) return null;
  if (key === "ArrowLeft") return (currentIndex - 1 + length) % length;
  if (key === "ArrowRight") return (currentIndex + 1) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

/**
 * タブドラッグのドロップ先 index を決める（HTML5 DnD とタッチドラッグで共用）。
 * `insertBefore` はドロップ位置がターゲットタブの左半分かどうか。
 * 自分自身を除いた挿入位置に補正し、0..length-1 にクランプする。
 */
export function resolveDropIndex(
  fromIndex: number,
  targetIndex: number,
  insertBefore: boolean,
  length: number,
): number {
  let toIndex = insertBefore ? targetIndex : targetIndex + 1;
  if (fromIndex < toIndex) toIndex -= 1;
  return Math.max(0, Math.min(toIndex, length - 1));
}
