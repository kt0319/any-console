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
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
