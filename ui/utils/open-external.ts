import { SAFARI_HANDOFF_FALLBACK_MS } from "./constants.ts";

export function isIosStandalonePwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return isIos && nav.standalone === true;
}

/** http(s) の別オリジンだけを Safari 本体用の x-safari-* URL に変換する。それ以外は null。 */
export function toSafariUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.origin === window.location.origin) return null;
  return `x-safari-${parsed.href}`;
}

function openInSafariApp(safariUrl: string, fallbackUrl: string): void {
  const fallbackTimer = setTimeout(() => {
    cleanup();
    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  }, SAFARI_HANDOFF_FALLBACK_MS);
  const onLeave = () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(fallbackTimer);
      cleanup();
    }
  };
  function cleanup() {
    document.removeEventListener("visibilitychange", onLeave);
    window.removeEventListener("pagehide", onLeave);
  }
  document.addEventListener("visibilitychange", onLeave);
  window.addEventListener("pagehide", () => { clearTimeout(fallbackTimer); cleanup(); });
  window.location.href = safariUrl;
}

/**
 * 外部URLを開く。falsy は no-op。逆参照防止に noopener,noreferrer を常に付ける。
 * iOS のスタンドアロン PWA では x-safari-* で Safari 本体へ渡し、起動しなければ通常URLで開く。
 * ユーザー操作（クリック等）のハンドラ内から呼ぶこと。
 */
export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  const safariUrl = isIosStandalonePwa() ? toSafariUrl(url) : null;
  if (safariUrl) {
    openInSafariApp(safariUrl, url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** `<a target="_blank">` の click 用。iOS PWA の別オリジン http(s) リンクだけ openExternal に差し替え、それ以外は既定動作に任せる。 */
export function onExternalLinkClick(e: MouseEvent): void {
  const anchor = (e.currentTarget as Element | null)?.closest?.("a");
  const href = anchor?.href;
  if (!href || !isIosStandalonePwa() || !toSafariUrl(href)) return;
  e.preventDefault();
  openExternal(href);
}
