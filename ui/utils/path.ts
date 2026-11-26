// "/"区切りパスの basename / dirname（純粋関数）。Windowsパスは扱わない。

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
