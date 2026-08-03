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

  it("agent_states メッセージを正規化して返す", () => {
    const raw = JSON.stringify({
      type: "agent_states",
      states: [{ session_id: "s1", state: "working" }],
    });
    expect(parseStatusStreamMessage(raw)).toEqual({
      type: "agent_states",
      states: [{ session_id: "s1", state: "working" }],
    });
  });

  it("agent_states の states が配列でなければ null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "agent_states", states: {} }))).toBe(null);
  });

  it("dispatch_queue メッセージを正規化して返す", () => {
    const raw = JSON.stringify({
      type: "dispatch_queue",
      items: [{ id: "d1", request: { workspace: "ws1", text: "echo hi" } }],
      recent: [{ id: "d0", request: { workspace: "ws1" }, decision: "approved" }],
    });
    expect(parseStatusStreamMessage(raw)).toEqual({
      type: "dispatch_queue",
      items: [{ id: "d1", request: { workspace: "ws1", text: "echo hi" } }],
      recent: [{ id: "d0", request: { workspace: "ws1" }, decision: "approved" }],
    });
  });

  it("dispatch_queue の空 items も通す（キュー空の全量スナップショット）", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "dispatch_queue", items: [] }))).toEqual({
      type: "dispatch_queue",
      items: [],
      recent: [],
    });
  });

  it("dispatch_queue の recent が無い/配列でなければ空配列にする", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "dispatch_queue", items: [], recent: {} }))).toEqual({
      type: "dispatch_queue",
      items: [],
      recent: [],
    });
  });

  it("dispatch_queue の items が配列でなければ null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "dispatch_queue", items: {} }))).toBe(null);
  });

  it("phrase_notify メッセージを正規化して返す", () => {
    const raw = JSON.stringify({
      type: "phrase_notify",
      session_id: "s1",
      phrase: "done!",
      workspace: "ws1",
    });
    expect(parseStatusStreamMessage(raw)).toEqual({
      type: "phrase_notify",
      session_id: "s1",
      phrase: "done!",
      workspace: "ws1",
    });
  });

  it("phrase_notify の workspace が無ければ null で補う", () => {
    const raw = JSON.stringify({ type: "phrase_notify", session_id: "s1", phrase: "done!" });
    expect(parseStatusStreamMessage(raw)).toEqual({
      type: "phrase_notify",
      session_id: "s1",
      phrase: "done!",
      workspace: null,
    });
  });

  it("phrase_notify の session_id が文字列でなければ null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "phrase_notify" }))).toBe(null);
  });

  it("phrase_notify_clear メッセージを正規化して返す", () => {
    const raw = JSON.stringify({ type: "phrase_notify_clear", session_id: "s1" });
    expect(parseStatusStreamMessage(raw)).toEqual({ type: "phrase_notify_clear", session_id: "s1" });
  });

  it("phrase_notify_clear の session_id が文字列でなければ null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "phrase_notify_clear" }))).toBe(null);
  });

  it("session_created メッセージを正規化して返す", () => {
    const raw = JSON.stringify({ type: "session_created", session_id: "s1" });
    expect(parseStatusStreamMessage(raw)).toEqual({ type: "session_created", session_id: "s1" });
  });

  it("session_removed メッセージを正規化して返す", () => {
    const raw = JSON.stringify({ type: "session_removed", session_id: "s1" });
    expect(parseStatusStreamMessage(raw)).toEqual({ type: "session_removed", session_id: "s1" });
  });

  it("session_created/session_removed の session_id が文字列でなければ null", () => {
    expect(parseStatusStreamMessage(JSON.stringify({ type: "session_created" }))).toBe(null);
    expect(parseStatusStreamMessage(JSON.stringify({ type: "session_removed" }))).toBe(null);
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
