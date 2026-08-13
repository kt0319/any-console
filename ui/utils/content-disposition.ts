// Content-Dispositionヘッダーからfilenameを取り出す純粋関数。
// フォルダダウンロード（バックエンドがzip化しfilename="dir.zip"を返す）等、
// レスポンス側が決めたファイル名をそのまま使いたい場合に使う。

export function extractFilenameFromContentDisposition(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // フォールバックへ
    }
  }
  const quotedMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1];
  const bareMatch = headerValue.match(/filename=([^;]+)/i);
  return bareMatch ? bareMatch[1].trim() : null;
}
