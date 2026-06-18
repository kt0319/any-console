/**
 * 矢印キー領域のフリック処理を生成する。
 *
 * - 左右フリック: snippet を切り替える（左=次, 右=前）
 * - 上下フリック: コマンド履歴を移動する（上=前, 下=次）
 *
 * 1 ジェスチャ内で複数回フリックが発火しても処理は 1 度だけに抑える（latch）。
 * タッチ開始ごとに `reset()` を呼ぶことで latch を解除する。
 *
 * KeyboardBar と QWERTY パネル下段の両方で共有する（以前は両者にコピペされていた）。
 *
 * @param {{
 *   isInputFocused: () => boolean,
 *   cycleSnippet: (dir: number) => void,
 *   historyPrev: () => void,
 *   historyNext: () => void,
 * }} deps
 */
export function createArrowFlickHandler({ isInputFocused, cycleSnippet, historyPrev, historyNext }) {
  let handled = false;
  return {
    reset() {
      handled = false;
    },
    /**
     * @param {{ key: string }} key
     * @returns {boolean} フリックを消費したら true
     */
    onFlick(key) {
      if (!isInputFocused()) return false;
      if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
        if (!handled) {
          handled = true;
          cycleSnippet(key.key === "ArrowLeft" ? 1 : -1);
        }
        return true;
      }
      if (handled) return true;
      handled = true;
      if (key.key === "ArrowUp") historyPrev();
      else if (key.key === "ArrowDown") historyNext();
      return true;
    },
  };
}
