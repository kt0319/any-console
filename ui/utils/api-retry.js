// apiGet の一時失敗（data == null）だけを 1 回だけ再試行する薄いラッパー。
// data == null はネットワーク断・レスポンス途中切れ・JSON パース失敗を示し、
// 再試行で回復しうる。detail 付きの構造化エラー（404 等）は data が非 null なので
// そのまま返し、無駄な再試行を避ける。

/**
 * @param {(endpoint: string, opts?: any) => Promise<{ok: boolean, data: any}>} get
 * @param {string} endpoint
 * @param {any} [opts] apiGet に渡す追加オプション（errorMessage 等）をそのまま転送する
 * @returns {Promise<{ok: boolean, data: any}>}
 */
export async function getWithRetry(get, endpoint, opts) {
  const first = await get(endpoint, opts);
  if (first.ok || first.data != null) return first;
  return get(endpoint, opts);
}
