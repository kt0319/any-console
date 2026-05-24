// タッチデバイス（hover 不可・粗いポインタ）判定。
// モーダル等で自動フォーカスを抑制し、ソフトキーボードの誤起動を防ぐ用途で使う。
export function isTouchOnly() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
}

// document に Escape キーのリスナーを capture フェーズで登録し、解除関数を返す。
export function listenForEscape(handler) {
  const onKeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handler(e);
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  return () => document.removeEventListener("keydown", onKeydown, true);
}
