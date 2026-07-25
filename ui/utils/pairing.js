// @ts-check

const PAIR_PATH_RE = /^\/pair\/([A-Za-z0-9_-]+)$/;

/**
 * 現在のURLがQRペアリング画面(`/pair/{id}?t=...`)かどうかを判定し、id/tokenを取り出す。
 * サーバ側の `/pair/{pairing_id}` ルートはSPAシェルをそのまま返すだけなので、
 * ルーティング自体はこの純粋関数でURLをパースして行う（vue-router非導入のため）。
 * @param {string} pathname
 * @param {string} search
 * @returns {{ id: string, token: string } | null}
 */
export function parsePairUrl(pathname, search) {
  const m = PAIR_PATH_RE.exec(pathname || "");
  if (!m) return null;
  const token = new URLSearchParams(search || "").get("t") || "";
  return { id: m[1], token };
}

/**
 * ペアリングの残り秒数を `M:SS` 形式に整形する（QRコードのカウントダウン表示用）。
 * @param {number} seconds
 * @returns {string}
 */
export function formatPairingCountdown(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
