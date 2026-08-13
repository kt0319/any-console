// ペインごとの「キー（ワークスペース等）が変わった時だけ読み込み直す」管理を
// 1箇所に集約するキー付き once-load。
//
// WorkspaceDetail では history/files/branch の読み込み済みフラグが個別の
// let 変数として散らばり、リセット漏れ・代入漏れによる不具合（例: コミット
// ファイル一覧から戻るとブランチ一覧が空になる、History 再訪時に表示状態が
// ずれる）の温床になっていたため、状態の持ち方をここへ寄せる。

export function usePaneLoader() {
  /** pane -> 最後にロードした時のキー */
  const loadedKeys = new Map<string, any>();

  /**
   * key が前回ロード時と同じならスキップし、違う時だけ loader を実行する。
   */
  function ensure(pane: string, key: any, loader: () => void) {
    if (loadedKeys.get(pane) === key) return;
    loadedKeys.set(pane, key);
    loader();
  }

  /**
   * 次回の ensure で必ず再ロードさせる（内容が変わった通知を受けた時等）。
   */
  function invalidate(pane: string) {
    loadedKeys.delete(pane);
  }

  /**
   * ensure を経由しない別経路で読み込んだ場合に、ロード済み扱いにする。
   */
  function markLoaded(pane: string, key: any) {
    loadedKeys.set(pane, key);
  }

  return { ensure, invalidate, markLoaded };
}
