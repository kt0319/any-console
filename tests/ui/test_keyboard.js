// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi } from "vitest";
import { listenForEscape } from "../../ui/utils/keyboard.js";

function dispatchKeydown(key) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("listenForEscape", () => {
  it("invokes handler on Escape keydown", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    dispatchKeydown("Escape");
    expect(handler).toHaveBeenCalledTimes(1);
    release();
  });

  it("ignores non-Escape keys", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    dispatchKeydown("Enter");
    dispatchKeydown("a");
    expect(handler).not.toHaveBeenCalled();
    release();
  });

  it("calls preventDefault on Escape", () => {
    const release = listenForEscape(() => {});
    const event = dispatchKeydown("Escape");
    expect(event.defaultPrevented).toBe(true);
    release();
  });

  it("does not call preventDefault on other keys", () => {
    const release = listenForEscape(() => {});
    const event = dispatchKeydown("Enter");
    expect(event.defaultPrevented).toBe(false);
    release();
  });

  it("release() stops further invocations", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    release();
    dispatchKeydown("Escape");
    expect(handler).not.toHaveBeenCalled();
  });
});
