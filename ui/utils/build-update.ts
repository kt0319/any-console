import { BUILD_UPDATE_RELOAD_GUARD_MS } from "./constants.ts";

const BUNDLE_PATTERN = /assets\/index-[\w-]+\.js/;
const RELOAD_GUARD_KEY = "__ac_build_reload_at__";

export function extractBundleName(html: string): string | null {
  return html.match(BUNDLE_PATTERN)?.[0] ?? null;
}

export function isNewBuildAvailable(loadedHtml: string, latestHtml: string): boolean {
  const loaded = extractBundleName(loadedHtml);
  const latest = extractBundleName(latestHtml);
  return !!loaded && !!latest && loaded !== latest;
}

function loadedBundleName(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.getAttribute("src");
  return src ? extractBundleName(src) : null;
}

function reloadGuardActive(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    if (Date.now() - last < BUILD_UPDATE_RELOAD_GUARD_MS) return true;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch { /* private mode 等 */ }
  return false;
}

// 開いたままのページはデプロイ後も古い bundle で動き続けるため、サーバの index.html が
// 指す bundle 名と読み込み済みの名前を比べ、違えば再読み込みする。
export async function reloadIfNewBuild(): Promise<void> {
  const loaded = loadedBundleName();
  if (!loaded) return;
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) throw new Error(`build check failed: HTTP ${res.status}`);
  if (!isNewBuildAvailable(loaded, await res.text()) || reloadGuardActive()) return;
  location.reload();
}
