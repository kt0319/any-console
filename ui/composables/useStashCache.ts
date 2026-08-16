// GitStash.vue の StashEntry 相当（stash 一覧のキャッシュ用途のみ、詳細フィールドは不要）。
type StashEntry = { ref: string, message: string, time?: string };

const _cache: Record<string, { data: StashEntry[], ts: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

export function setStashCache(workspace: string, data: StashEntry[]) {
  _cache[workspace] = { data, ts: Date.now() };
}

export function invalidateStashCache(workspace: string) {
  delete _cache[workspace];
}

export function getStashCachedCount(workspace: string) {
  const c = _cache[workspace];
  if (c && Date.now() - c.ts <= CACHE_TTL) return c.data.length;
  return null;
}
