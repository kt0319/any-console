// "/"区切りパスの basename / dirname（純粋関数）。ワークスペース相対パスは
// 常に "/" 区切り（Windowsパスは扱わない）前提。各所に散在していた
// lastIndexOf("/") / split("/").pop() のインライン実装はこちらへ寄せる。

/**
 * パスの末尾要素。区切りが無ければ全体を返す。
 */
export function basename(path: string | null | undefined): string {
  const s = String(path || "");
  const idx = s.lastIndexOf("/");
  return idx < 0 ? s : s.slice(idx + 1);
}

/**
 * パスの親ディレクトリ。区切りが無ければ空文字（ルート直下扱い）。
 */
export function dirname(path: string | null | undefined): string {
  const s = String(path || "");
  const idx = s.lastIndexOf("/");
  return idx < 0 ? "" : s.slice(0, idx);
}
