const PAIR_PATH_RE = /^\/pair\/([A-Za-z0-9_-]+)$/;

/** 現在のURLがQRペアリング画面（/pair/{id}?t=...）か判定し id/token を取り出す。サーバは SPA シェルを返すだけなのでURLパースで行う。 */
export function parsePairUrl(pathname: string, search: string): { id: string; token: string } | null {
  const m = PAIR_PATH_RE.exec(pathname || "");
  if (!m) return null;
  const token = new URLSearchParams(search || "").get("t") || "";
  return { id: m[1], token };
}

/** ペアリングの残り秒数を M:SS に整形する。 */
export function formatPairingCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
