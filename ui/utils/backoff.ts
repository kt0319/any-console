import {
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX,
  RECONNECT_BACKOFF_MULTIPLIER,
} from "./constants.ts";

/**
 * WS 再接続の指数バックオフ遅延（attempt は 0 始まり）。
 * ターミナル WS とステータスストリーム WS が同じ定数系・同じ計算を共有する。
 *
 * initialDelay を指定すると初回（attempt 0）だけその値になり、以降の指数は
 * attempt-1 で数える（ターミナル WS の「初回だけ素早く再接続」挙動）。
 */
export function reconnectBackoffDelay(attempt: number, { initialDelay }: { initialDelay?: number } = {}): number {
  if (initialDelay != null) {
    if (attempt === 0) return initialDelay;
    attempt -= 1;
  }
  const delay = RECONNECT_BACKOFF_BASE_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempt);
  return Math.min(delay, RECONNECT_BACKOFF_MAX);
}
