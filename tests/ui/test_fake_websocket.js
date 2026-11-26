import { describe, it, expect, vi } from "vitest";
import { WS_CONNECTING, WS_OPEN, WS_CLOSING, WS_CLOSED, fakeOpenSocket } from "./helpers/fake-websocket.js";

describe("fake-websocket", () => {
  it.skipIf(typeof WebSocket === "undefined")("定数が WebSocket の readyState と一致する", () => {
    expect(WS_CONNECTING).toBe(WebSocket.CONNECTING);
    expect(WS_OPEN).toBe(WebSocket.OPEN);
    expect(WS_CLOSING).toBe(WebSocket.CLOSING);
    expect(WS_CLOSED).toBe(WebSocket.CLOSED);
  });

  it("fakeOpenSocket は OPEN 状態に追加プロパティを載せる", () => {
    const send = vi.fn();
    expect(fakeOpenSocket({ send })).toEqual({ readyState: WS_OPEN, send });
  });
});
