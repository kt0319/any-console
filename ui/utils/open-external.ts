/** 外部URLを新しいタブで開く。falsy は no-op。逆参照防止に noopener,noreferrer を常に付ける。 */
export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
