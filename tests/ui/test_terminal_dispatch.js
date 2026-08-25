// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { dispatchKeyToTab, dispatchTextToTab } from "../../ui/utils/terminal-dispatch.ts";
import { useTerminalStore } from "../../ui/stores/terminal.ts";
import { useAgentStateStore } from "../../ui/stores/agent-state.ts";

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

  it("dispatchKeyToTab は送信に成功したら対象タブの doneSessions/phraseNotifySessions をクリアする", () => {
    const { tab } = makeTab();
    useAgentStateStore().doneSessions.s1 = true;
    useAgentStateStore().phraseNotifySessions.s1 = true;

    expect(dispatchKeyToTab(tab, { key: "Enter" })).toBe(true);

    expect(useAgentStateStore().doneSessions.s1).toBeUndefined();
    expect(useAgentStateStore().phraseNotifySessions.s1).toBeUndefined();
  });

  it("dispatchTextToTab は送信に成功したら対象タブの doneSessions/phraseNotifySessions をクリアする", () => {
    const { tab } = makeTab();
    useAgentStateStore().doneSessions.s1 = true;
    useAgentStateStore().phraseNotifySessions.s1 = true;

    expect(dispatchTextToTab(tab, "hello")).toBe(true);

    expect(useAgentStateStore().doneSessions.s1).toBeUndefined();
    expect(useAgentStateStore().phraseNotifySessions.s1).toBeUndefined();
  });

  it("WSが閉じていれば送信されず doneSessions/phraseNotifySessions もクリアしない", () => {
    const { tab } = makeTab();
    tab.ws.readyState = WebSocket.CLOSED;
    useAgentStateStore().doneSessions.s1 = true;
    useAgentStateStore().phraseNotifySessions.s1 = true;

    expect(dispatchTextToTab(tab, "hello")).toBe(false);

    expect(useAgentStateStore().doneSessions.s1).toBe(true);
    expect(useAgentStateStore().phraseNotifySessions.s1).toBe(true);
  });
});
