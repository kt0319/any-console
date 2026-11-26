/** confirm / prompt / dispatch などダイアログの結果待ちモーダルが共通で持つ単一の保留 Promise 管理。状態 ref はモーダル側が持つ。 */
export function createPendingPromise() {
  let resolve: ((value: any) => void) | null = null;
  return {
    get pending() {
      return resolve !== null;
    },
    /** 新しい待機を開始する。前回が未解決なら supersedeValue で解決して破棄する。 */
    begin(supersedeValue: any): Promise<any> {
      if (resolve) {
        const prev = resolve;
        resolve = null;
        prev(supersedeValue);
      }
      return new Promise((r) => {
        resolve = r;
      });
    },
    settle(value: any) {
      const r = resolve;
      resolve = null;
      r?.(value);
    },
  };
}
