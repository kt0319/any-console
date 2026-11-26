import qrcode from "qrcode-generator";

/**
 * URLをQRコードのSVGマークアップ文字列に変換する。text が空なら空文字列。
 * スキャン確実性のためテーマに追従せず黒/白固定。
 */
export function generateQrSvg(text: string): string {
  if (!text) return "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}
