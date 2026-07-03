import { describe, it, expect } from "vitest";
import {
  buildStatusStreamUrl,
  parseStatusStreamMessage,
  statusStreamReconnectDelay,
} from "../../ui/utils/status-stream.js";
import {
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
  RECONNECT_BACKOFF_MAX,
} from "../../ui/utils/constants.js";

describe("buildStatusStreamUrl", () => {
  it("ws/wss と host から URL を組み立てる", () => {
    expect(buildStatusStreamUrl("ws:", "localhost:8888")).toBe(
      "ws://localhost:8888/workspaces/statuses/ws",
    );
    expect(buildStatusStreamUrl("wss:", "console.example.ts.net")).toBe(
      "wss://console.example.ts.net/workspaces/statuses/ws",
    );
  });
});

describe("parseStatusStreamMessage", () => {
  it("statuses メッセージを正規化して返す", () => {
    const raw = JSON.stringify({
      type: "statuses",
      statuses: [{ name: "ws1", clean: false, ahead: 2 }],
    });
    expect(parseStatusStreamMessage(raw)).toEqual({
      type: "statuses",
      statuses: [{ name: "ws1", clean: false, ahead: 2 }],
    });
  });

  it("ping メッセージは null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "ping" }))).toBe(null);
  });

  it("不正 JSON は null", () => {
    expect(parseStatusStreamMessage("{oops")).toBe(null);
  });

  it("文字列以外は null", () => {
    expect(parseStatusStreamMessage(new ArrayBuffer(4))).toBe(null);
    expect(parseStatusStreamMessage(undefined)).toBe(null);
  });

  it("statuses が配列でない・未知 type・null は null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "statuses", statuses: {} }))).toBe(null);
    expect(parseStatusStreamMessage(JSON.stringify({ type: "other", statuses: [] }))).toBe(null);
    expect(parseStatusStreamMessage(JSON.stringify(null))).toBe(null);
    expect(parseStatusStreamMessage(JSON.stringify({ statuses: [] }))).toBe(null);
  });
});

describe("statusStreamReconnectDelay", () => {
  it("試行回数に応じて指数的に増える", () => {
    expect(statusStreamReconnectDelay(0)).toBe(RECONNECT_BACKOFF_BASE_MS);
    expect(statusStreamReconnectDelay(1)).toBe(
      RECONNECT_BACKOFF_BASE_MS * RECONNECT_BACKOFF_MULTIPLIER,
    );
  });

  it("上限で頭打ちになる", () => {
    expect(statusStreamReconnectDelay(10)).toBe(RECONNECT_BACKOFF_MAX);
  });
});
