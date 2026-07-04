const _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

export function setStashCache(workspace, data) {
  _cache[workspace] = { data, ts: Date.now() };
}

export function invalidateStashCache(workspace) {
  delete _cache[workspace];
}

export function getStashCachedCount(workspace) {
  const c = _cache[workspace];
  if (c && Date.now() - c.ts <= CACHE_TTL) return c.data.length;
  return null;
}
