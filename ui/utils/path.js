// "/"区切りパスの basename / dirname（純粋関数）。ワークスペース相対パスは
// 常に "/" 区切り（Windowsパスは扱わない）前提。各所に散在していた
// lastIndexOf("/") / split("/").pop() のインライン実装はこちらへ寄せる。

/**
 * パスの末尾要素。区切りが無ければ全体を返す。
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function basename(path) {
  const s = String(path || "");
  const idx = s.lastIndexOf("/");
  return idx < 0 ? s : s.slice(idx + 1);
}

/**
 * パスの親ディレクトリ。区切りが無ければ空文字（ルート直下扱い）。
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function dirname(path) {
  const s = String(path || "");
  const idx = s.lastIndexOf("/");
  return idx < 0 ? "" : s.slice(0, idx);
}
