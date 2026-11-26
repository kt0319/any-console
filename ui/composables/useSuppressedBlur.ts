import { nextTick, type Ref } from "vue";

/** markInternal 直後の blur をキャンセルして再フォーカスする（モーダル内ボタンタップ等の内部操作用）。 */
export function useSuppressedBlur(inputEl: Ref<HTMLElement | HTMLInputElement | null>) {
  let suppressed = false;
  let refocusToken = 0;

  function markInternal() {
    suppressed = true;
  }

  function blur() {
    suppressed = false;
    refocusToken += 1;
    inputEl.value?.blur();
  }

  function resetSuppression() {
    suppressed = false;
    refocusToken += 1;
  }

  /** blur ハンドラから呼ぶ。抑制中は再フォーカスを予約して false、通常 blur は true を返す。 */
  function handleBlur() {
    if (!suppressed) return true;
    suppressed = false;
    const token = ++refocusToken;
    nextTick(() => { if (token === refocusToken) inputEl.value?.focus(); });
    return false;
  }

  return { markInternal, blur, handleBlur, resetSuppression };
}
