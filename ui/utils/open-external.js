/**
 * 外部URLを新しいタブで開く（window.open 版の単一実装）。
 * falsy な URL は no-op。opener 経由の逆参照を防ぐため常に noopener,noreferrer を付ける。
 * iOS PWA で外部ブラウザに逃したい場合は openExternalUrl（anchor 版）を使う。
 */
export function openExternal(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 外部URLを新しいウィンドウ/タブで開く。
 * iOS PWAではwindow.openがPWA内で開いてしまうため、anchor要素経由でクリックする。
 * これにより外部ブラウザ（Safari）で開かれることが多い。
 */
export function openExternalUrl(url) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "external noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
