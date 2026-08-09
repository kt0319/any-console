// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { bindTerminalInput } from "../../ui/composables/useTerminalInput.js";

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
    setActivePinia(createPinia());
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
});
