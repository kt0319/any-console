/**
 * 「変化を watch → debounce してサーバーへ保存」系 composable
 * （useLayoutPersist / useBrowserTabsPersist）で共有する debounce スケジューラ。
 * モジュールレベルに1つ作り、schedule() を呼ぶたびに前回の予約を取り消して
 * 後勝ちで保存関数を予約する（保存関数は composable 呼び出しごとに作られる
 * クロージャのため、タイマーではなく関数を受け取る形にしている）。
 */
export function createSaveScheduler(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn: () => void) {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
