// Dev server preview の URL 組み立て（純粋関数）。
// ユニークポート方式: any-console が target+20000 で TCP proxy を立てている。
// proxy 証明書があれば scheme=https で TLS 終端、無ければ http。
// hostname は呼び出し側が location.hostname を渡す（テスト容易性のため window 非依存）。

/**
 * proxy 経由の origin（末尾スラッシュなし）。proxy 未設定なら空文字。
 * @param {{scheme?: string, proxy_port?: number} | null | undefined} entry
 * @param {string} hostname
 * @returns {string}
 */
export function devServerOrigin(entry, hostname) {
  if (!entry || !entry.proxy_port) return "";
  return `${entry.scheme || "http"}://${hostname}:${entry.proxy_port}`;
}

/**
 * proxy 経由のプレビュー URL（末尾スラッシュあり）。proxy 未設定なら空文字。
 * @param {{scheme?: string, proxy_port?: number} | null | undefined} entry
 * @param {string} hostname
 * @returns {string}
 */
export function devServerUrl(entry, hostname) {
  const origin = devServerOrigin(entry, hostname);
  return origin ? `${origin}/` : "";
}
