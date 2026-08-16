/**
 * 外部URLを新しいタブで開く（window.open 版の単一実装）。
 * falsy な URL は no-op。opener 経由の逆参照を防ぐため常に noopener,noreferrer を付ける。
 */
export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
