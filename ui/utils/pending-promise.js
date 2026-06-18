/**
 * 単一の保留中 Promise を管理する小さなヘルパー。
 *
 * confirm / prompt / dispatch などの「ダイアログを開いて結果を待つ」モーダルが
 * 共通で持っていた _resolve 管理（再入時に前回を既定値で解決して捨てる／
 * 解決時に参照を片付ける）を 1 箇所にまとめたもの。状態 ref はモーダル側が
 * 保持し、Promise の解決機構だけをここで扱う。
 */
export function createPendingPromise() {
  /** @type {((value: any) => void) | null} */
  let resolve = null;
  return {
    /** 保留中の Promise があるか。 */
    get pending() {
      return resolve !== null;
    },
    /**
     * 新しい待機を開始する。前回が未解決なら supersedeValue で解決して破棄する。
     * @param {*} supersedeValue 前回の待機を解決する値
     * @returns {Promise<*>}
     */
    begin(supersedeValue) {
      if (resolve) {
        const prev = resolve;
        resolve = null;
        prev(supersedeValue);
      }
      return new Promise((r) => {
        resolve = r;
      });
    },
    /**
     * 現在の待機を value で解決する。保留が無ければ何もしない。
     * @param {*} value
     */
    settle(value) {
      const r = resolve;
      resolve = null;
      r?.(value);
    },
  };
}
