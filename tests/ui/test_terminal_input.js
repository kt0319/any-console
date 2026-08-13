// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { bindTerminalInput } from "../../ui/composables/useTerminalInput.js";
import { useLayoutStore } from "../../ui/stores/layout.js";
import { useTerminalStore } from "../../ui/stores/terminal.js";

function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

function makeTab() {
  const sent = [];
  const term = {
    attachCustomKeyEventHandler: vi.fn((handler) => {
      term.keyHandler = handler;
    }),
    onSelectionChange: vi.fn(),
    parser: { registerOscHandler: vi.fn() },
    onData: vi.fn(),
    onResize: vi.fn(),
    onKey: vi.fn(),
  };
  return {
    sent,
    tab: {
      id: 1,
      sessionId: "s1",
      ws: {
        readyState: WebSocket.OPEN,
        send: vi.fn((bytes) => sent.push(bytes)),
      },
      term,
    },
    term,
  };
}

describe("bindTerminalInput", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    useTerminalStore().activeTabId = 1;
    const layoutStore = useLayoutStore();
    layoutStore.isSessionSidebarOpen = false;
    layoutStore.isSettingsOpen = false;
  });

  it("captures PageUp/PageDown globally when the active xterm textarea does not receive the event", () => {
    const { sent, tab } = makeTab();
    bindTerminalInput(tab);

    const pageUp = new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true });
    const pageDown = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });

    window.dispatchEvent(pageUp);
    window.dispatchEvent(pageDown);

    expect(pageUp.defaultPrevented).toBe(true);
    expect(pageDown.defaultPrevented).toBe(true);
    expect(sent.map(decode)).toEqual(["\x1b[5~", "\x1b[6~"]);

    tab._releaseInput();
  });

  it("does not globally capture Shift+PageUp/PageDown", () => {
    const { sent, tab } = makeTab();
    bindTerminalInput(tab);

    const pageUp = new KeyboardEvent("keydown", { key: "PageUp", shiftKey: true, bubbles: true, cancelable: true });
    const pageDown = new KeyboardEvent("keydown", { key: "PageDown", shiftKey: true, bubbles: true, cancelable: true });

    window.dispatchEvent(pageUp);
    window.dispatchEvent(pageDown);

    expect(pageUp.defaultPrevented).toBe(false);
    expect(pageDown.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);

    tab._releaseInput();
  });

  it("sends unmodified PageUp/PageDown to the terminal app", () => {
    const { sent, tab, term } = makeTab();
    bindTerminalInput(tab);

    const pageUp = new KeyboardEvent("keydown", { key: "PageUp", cancelable: true });
    const pageDown = new KeyboardEvent("keydown", { key: "PageDown", cancelable: true });

    expect(term.keyHandler(pageUp)).toBe(false);
    expect(term.keyHandler(pageDown)).toBe(false);
    expect(pageUp.defaultPrevented).toBe(true);
    expect(pageDown.defaultPrevented).toBe(true);
    expect(sent.map(decode)).toEqual(["\x1b[5~", "\x1b[6~"]);
  });

  it("leaves Shift+PageUp/PageDown for xterm scrollback", () => {
    const { sent, tab, term } = makeTab();
    bindTerminalInput(tab);

    const pageUp = new KeyboardEvent("keydown", { key: "PageUp", shiftKey: true, cancelable: true });
    const pageDown = new KeyboardEvent("keydown", { key: "PageDown", shiftKey: true, cancelable: true });

    expect(term.keyHandler(pageUp)).toBe(true);
    expect(term.keyHandler(pageDown)).toBe(true);
    expect(pageUp.defaultPrevented).toBe(false);
    expect(pageDown.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it("PageUp/PageDown送信でそのタブのdoneSessionsをクリアする", () => {
    const { tab } = makeTab();
    bindTerminalInput(tab);
    useTerminalStore().doneSessions.s1 = true;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true }));

    expect(useTerminalStore().doneSessions.s1).toBeUndefined();
    tab._releaseInput();
  });

  it("ターミナルへの入力(onData)でそのタブのdoneSessionsをクリアする", () => {
    const { tab, term } = makeTab();
    bindTerminalInput(tab);
    useTerminalStore().doneSessions.s1 = true;

    const onDataHandler = term.onData.mock.calls[0][0];
    onDataHandler("a");

    expect(useTerminalStore().doneSessions.s1).toBeUndefined();
  });

  it("選択時の自動コピーはcopyOnSelect設定に従う", () => {
    const { tab, term } = makeTab();
    term.getSelection = vi.fn(() => "selected text");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    bindTerminalInput(tab);
    const onSelection = term.onSelectionChange.mock.calls[0][0];

    onSelection();
    expect(writeText).toHaveBeenCalledWith("selected text");

    useTerminalStore().setTerminalSetting("copyOnSelect", false);
    onSelection();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("OSC 52のクリップボード書き込みもcopyOnSelect設定に従う", () => {
    const { tab, term } = makeTab();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    bindTerminalInput(tab);
    const oscHandler = term.parser.registerOscHandler.mock.calls[0][1];
    const payload = `c;${btoa("copied via osc52")}`;

    expect(oscHandler(payload)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("copied via osc52");

    useTerminalStore().setTerminalSetting("copyOnSelect", false);
    expect(oscHandler(payload)).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
