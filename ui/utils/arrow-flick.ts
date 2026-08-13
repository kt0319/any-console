/**
 * 矢印キー領域のフリック処理を生成する。
 *
 * - 上下フリック: 入力欄フォーカス中はコマンド履歴を移動する（上=前, 下=次）
 * - 左右フリック: 処理しない（呼び出し側の既定動作＝ターミナルへの矢印キー送信に委ねる）
 *
 * 1 ジェスチャ内で複数回フリックが発火しても処理は 1 度だけに抑える（latch）。
 * タッチ開始ごとに `reset()` を呼ぶことで latch を解除する。
 *
 * KeyboardBar と QWERTY パネル下段の両方で共有する（以前は両者にコピペされていた）。
 */
export function createArrowFlickHandler({ isInputFocused, historyPrev, historyNext }: {
  isInputFocused: () => boolean,
  historyPrev: () => void,
  historyNext: () => void,
}) {
  let handled = false;
  return {
    reset() {
      handled = false;
    },
    /**
     * @returns フリックを消費したら true
     */
    onFlick(key: { key: string }): boolean {
      if (key.key === "ArrowLeft" || key.key === "ArrowRight") return false;
      if (!isInputFocused()) return false;
      if (handled) return true;
      handled = true;
      if (key.key === "ArrowUp") historyPrev();
      else if (key.key === "ArrowDown") historyNext();
      return true;
    },
  };
}
