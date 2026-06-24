// @ts-check

/**
 * テキストをクリップボードへコピーする。
 * secure context（HTTPS / localhost）では navigator.clipboard を使い、使えない環境
 * （Tailscale 経由の HTTP など非 secure context や権限拒否）では textarea +
 * execCommand("copy") にフォールバックする。
 * @param {string} text
 * @returns {Promise<boolean>} コピーに成功したら true
 */
export async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* 権限拒否・非 secure context はフォールバックへ */ }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
