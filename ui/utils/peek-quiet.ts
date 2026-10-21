import { PILL_PEEK_RESYNC_QUIET_MS } from "./constants.ts";

// サーバ再起動などで status stream が切れた間と、再接続直後の全量再同期の間は、
// ピルの値の入れ替わりを「変化」と誤検知してpeekを出さないための状態。
let streamLost = false;
let quietUntil = 0;

export function markStreamLost() {
  streamLost = true;
}

export function markStreamRecovered(now = Date.now()) {
  if (!streamLost) return;
  streamLost = false;
  quietUntil = now + PILL_PEEK_RESYNC_QUIET_MS;
}

export function isPeekQuiet(now = Date.now()) {
  return streamLost || now < quietUntil;
}

export function resetPeekQuietForTest() {
  streamLost = false;
  quietUntil = 0;
}
