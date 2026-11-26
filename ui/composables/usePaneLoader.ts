// ペインごとに、キーが変わった時だけ読み込み直すキー付き once-load。
// 読み込み済みフラグが散在してリセット漏れ（戻ると空になる等）を起こしていたため集約した。

export function usePaneLoader() {
  const loadedKeys = new Map<string, any>();

  function ensure(pane: string, key: any, loader: () => void) {
    if (loadedKeys.get(pane) === key) return;
    loadedKeys.set(pane, key);
    loader();
  }

  function invalidate(pane: string) {
    loadedKeys.delete(pane);
  }

  function markLoaded(pane: string, key: any) {
    loadedKeys.set(pane, key);
  }

  return { ensure, invalidate, markLoaded };
}
