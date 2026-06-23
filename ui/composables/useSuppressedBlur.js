import { nextTick } from "vue";

/**
 * input 要素の blur を内部操作（モーダル内のボタンタップ等）だけ一時的に抑制する。
 * markInternal を呼んだ直後の blur イベントはキャンセル扱いになり、
 * 自動で再フォーカスが当たる。`submit` や明示的 `blur` ではこの抑制をリセットする。
 *
 * @param {import("vue").Ref<HTMLElement | HTMLInputElement | null>} inputEl
 */
export function useSuppressedBlur(inputEl) {
  let suppressed = false;
  let refocusToken = 0;

  /** 直後の blur を抑制して再フォーカスする（外部の pointerdown 等から呼ぶ）。 */
  function markInternal() {
    suppressed = true;
  }

  /** 抑制状態を解除して即座に blur する。 */
  function blur() {
    suppressed = false;
    refocusToken += 1;
    inputEl.value?.blur();
  }

  /** 抑制状態を解除する（submit 完了時等、blur 自体は呼びたい場合）。 */
  function resetSuppression() {
    suppressed = false;
    refocusToken += 1;
  }

  /**
   * blur イベントハンドラから呼ぶ。抑制中なら再フォーカスを予約し false を返す。
   * 通常 blur のときは true を返すので、呼び出し側で通常の後処理（focused=false 等）を続ける。
   */
  function handleBlur() {
    if (!suppressed) return true;
    suppressed = false;
    const token = ++refocusToken;
    nextTick(() => { if (token === refocusToken) inputEl.value?.focus(); });
    return false;
  }

  return { markInternal, blur, handleBlur, resetSuppression };
}
