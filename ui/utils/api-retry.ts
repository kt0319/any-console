// apiGet の一時失敗（data == null: 通信断・途中切れ・JSONパース失敗）だけを 1 回再試行する。
// detail 付きの構造化エラーは data が非 null なのでそのまま返す。

/**
 * @param opts apiGet に渡す追加オプション（errorMessage 等）をそのまま転送する
 */
export async function getWithRetry(
  get: (endpoint: string, opts?: any) => Promise<{ ok: boolean, data: any }>,
  endpoint: string,
  opts?: any,
): Promise<{ ok: boolean, data: any }> {
  const first = await get(endpoint, opts);
  if (first.ok || first.data != null) return first;
  return get(endpoint, opts);
}
