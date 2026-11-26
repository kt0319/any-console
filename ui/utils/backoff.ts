import {
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX,
  RECONNECT_BACKOFF_MULTIPLIER,
} from "./constants.ts";

/**
 * WS 再接続の指数バックオフ遅延（attempt は 0 始まり。ターミナル WS とステータスストリーム WS で共有）。
 * initialDelay 指定時は attempt 0 だけその値になり、以降は attempt-1 で数える（ターミナル WS の初回だけ素早い再接続）。
 */
export function reconnectBackoffDelay(attempt: number, { initialDelay }: { initialDelay?: number } = {}): number {
  if (initialDelay != null) {
    if (attempt === 0) return initialDelay;
    attempt -= 1;
  }
  const delay = RECONNECT_BACKOFF_BASE_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempt);
  return Math.min(delay, RECONNECT_BACKOFF_MAX);
}
