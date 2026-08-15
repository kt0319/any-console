// タッチデバイス（hover 不可・粗いポインタ）判定。
// モーダル等で自動フォーカスを抑制し、ソフトキーボードの誤起動を防ぐ用途で使う。
export function isTouchOnly() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
}

// 複数行textareaでカーソルが最初の行にあるか（＝これ以上上に行移動できないか）。
// 履歴↑を行移動と区別するために使う（KeyboardInput.vue）。
export function isCaretOnFirstLine(value, selectionStart) {
  return !value.slice(0, selectionStart ?? 0).includes("\n");
}

// 複数行textareaでカーソルが最後の行にあるか（＝これ以上下に行移動できないか）。
export function isCaretOnLastLine(value, selectionEnd) {
  return !value.slice(selectionEnd ?? value.length).includes("\n");
}

// document に Escape キーのリスナーを capture フェーズで登録し、解除関数を返す。
// stopPropagation も呼ぶ（preventDefaultだけだとイベントはターゲット（xterm.jsの
// 隠しtextarea等）まで届いてしまい、モーダルを閉じたつもりのEscapeがESCバイトと
// してそのままターミナルへ送られてしまう。シェルのZLEはESC直後の1文字を
// メタキー結合として解釈するため、次に入力した文字が欠落する不具合になっていた）。
export function listenForEscape(handler) {
  const onKeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  return () => document.removeEventListener("keydown", onKeydown, true);
}
