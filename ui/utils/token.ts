/**
 * ランダムな hex トークンを生成する（AuthConfig の Regenerate ボタン用）。
 * @param bytes 乱数のバイト数（生成される文字列は bytes*2 文字）
 */
export function generateHexToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
