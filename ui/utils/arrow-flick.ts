/**
 * 矢印キー領域のフリック処理を生成する（KeyboardBar と QWERTY パネル下段で共有）。
 * 入力欄フォーカス中のみ、上下=コマンド履歴・左右=スニペット一覧を移動する。未フォーカスなら呼び出し側の既定動作に委ねる。
 * 1 ジェスチャ内の複数発火は 1 度だけ処理し（latch）、タッチ開始ごとに reset() で解除する。
 */
export function createArrowFlickHandler({
  isInputFocused, historyPrev, historyNext, snippetPrev, snippetNext,
}: {
  isInputFocused: () => boolean,
  historyPrev: () => void,
  historyNext: () => void,
  snippetPrev: () => void,
  snippetNext: () => void,
}) {
  let handled = false;
  return {
    reset() {
      handled = false;
    },
    /** @returns フリックを消費したら true */
    onFlick(key: { key: string }): boolean {
      if (!isInputFocused()) return false;
      if (handled) return true;
      handled = true;
      if (key.key === "ArrowUp") historyPrev();
      else if (key.key === "ArrowDown") historyNext();
      else if (key.key === "ArrowLeft") snippetPrev();
      else if (key.key === "ArrowRight") snippetNext();
      return true;
    },
  };
}
