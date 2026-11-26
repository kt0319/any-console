// 本体は WebSocket.OPEN で判定する。モックに裸の 1 を書くと、「送らない」系のテストが
// 状態の取り違えでも素通りするため、意図を名前で残す。
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export function fakeSocket(readyState, extra = {}) {
  return { readyState, ...extra };
}

export function fakeOpenSocket(extra = {}) {
  return fakeSocket(WS_OPEN, extra);
}
