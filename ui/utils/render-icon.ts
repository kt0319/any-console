function hasFetchableFavicon(domain: string | null | undefined): boolean {
  if (!domain) return false;
  let host = domain;
  try {
    if (/^https?:\/\//i.test(domain)) host = new URL(domain).hostname;
  } catch { /* keep original */ }
  host = host.split("/")[0].split(":")[0];
  if (!host || host === "localhost") return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host.includes(":") || host.startsWith("[")) return false;
  return host.includes(".");
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-zA-Z0-9+/=]+$/;
const ICON_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const MDI_ICON_RE = /^mdi-[a-z0-9-]+$/;

function normalizeSize(size: number | string | null | undefined): number {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return 16;
  return Math.round(n);
}

function safeIconPath(path: string): string | null {
  if (!ICON_PATH_RE.test(path)) return null;
  if (path.includes("..") || path.includes("//")) return null;
  return path;
}

export function renderIconStr(icon: string | null | undefined, color?: string | null, size: number | string = 16): string {
  if (!icon || typeof icon !== "string") return "";
  const safeSize = normalizeSize(size);
  if (icon.startsWith("data:image/")) {
    if (!DATA_IMAGE_RE.test(icon)) return "";
    return `<img src="${icon}" width="${safeSize}" height="${safeSize}" class="favicon-icon" draggable="false" alt="" />`;
  }
  if (icon.startsWith("icon:")) {
    const path = safeIconPath(icon.slice(5));
    if (!path) return "";
    return `<img src="/icons/${path}" width="${safeSize}" height="${safeSize}" class="favicon-icon" draggable="false" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    if (!hasFetchableFavicon(domain)) {
      return `<span class="mdi mdi-web" style="font-size:${safeSize}px"></span>`;
    }
    return `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" width="${safeSize}" height="${safeSize}" class="favicon-icon" draggable="false" alt="" />`;
  }
  if (!MDI_ICON_RE.test(icon)) return "";
  const styles = [`font-size:${safeSize}px`];
  if (color && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(color)) styles.push(`color:${color}`);
  return `<span class="mdi ${icon}" style="${styles.join(";")}"></span>`;
}
