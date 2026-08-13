import qrcode from "qrcode-generator";

/**
 * URLをQRコードのSVGマークアップ文字列に変換する。
 *
 * カメラでのスキャン確実性のため常に黒地(dark)/白地(light)固定の配色にする
 * （アプリのテーマに追従させない）。qrcode-generator の createSvgTag(scalable)
 * は width/height を持たない viewBox 付きSVGを返すため、コンテナ側のCSSで
 * 自由にサイズ調整できる。
 * @returns SVGマークアップ。text が空なら空文字列。
 */
export function generateQrSvg(text: string): string {
  if (!text) return "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}
