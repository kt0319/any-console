// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { dispatchKeyToTab, dispatchTextToTab } from "../../ui/utils/terminal-dispatch.js";
import { useTerminalStore } from "../../ui/stores/terminal.js";

function makeTab(sessionId = "s1") {
  const sent = [];
  return {
    sent,
    tab: {
      sessionId,
      ws: {
        readyState: WebSocket.OPEN,
        send: vi.fn((bytes) => sent.push(bytes)),
      },
    },
  };
}

describe("terminal-dispatch", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("dispatchKeyToTab は送信に成功したら対象タブの doneSessions をクリアする", () => {
    const { tab } = makeTab();
    useTerminalStore().doneSessions.s1 = true;

    expect(dispatchKeyToTab(tab, { key: "Enter" })).toBe(true);

    expect(useTerminalStore().doneSessions.s1).toBeUndefined();
  });

  it("dispatchTextToTab は送信に成功したら対象タブの doneSessions をクリアする", () => {
    const { tab } = makeTab();
    useTerminalStore().doneSessions.s1 = true;

    expect(dispatchTextToTab(tab, "hello")).toBe(true);

    expect(useTerminalStore().doneSessions.s1).toBeUndefined();
  });

  it("WSが閉じていれば送信されず doneSessions もクリアしない", () => {
    const { tab } = makeTab();
    tab.ws.readyState = WebSocket.CLOSED;
    useTerminalStore().doneSessions.s1 = true;

    expect(dispatchTextToTab(tab, "hello")).toBe(false);

    expect(useTerminalStore().doneSessions.s1).toBe(true);
  });
});
