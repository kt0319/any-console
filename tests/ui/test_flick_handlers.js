// @ts-check
import { describe, it, expect, vi } from "vitest";
import { createFlickHandlers } from "../../ui/utils/flick-handlers.js";

function makeStartEvent(x, y) {
  const target = { classList: { add: vi.fn(), remove: vi.fn() } };
  return { currentTarget: target, touches: [{ clientX: x, clientY: y }] };
}

function makeEndEvent(target, x, y) {
  return { currentTarget: target, changedTouches: [{ clientX: x, clientY: y }] };
}

describe("createFlickHandlers", () => {
  it("invokes tap when movement is below threshold", () => {
    const tap = vi.fn();
    const handlers = createFlickHandlers({ tap });
    const start = makeStartEvent(100, 100);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 105, 105));
    expect(tap).toHaveBeenCalledOnce();
  });

  it("invokes up for upward flick beyond threshold", () => {
    const up = vi.fn();
    const handlers = createFlickHandlers({ up });
    const start = makeStartEvent(100, 200);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 100, 100));
    expect(up).toHaveBeenCalledOnce();
  });

  it("invokes down for downward flick beyond threshold", () => {
    const down = vi.fn();
    const handlers = createFlickHandlers({ down });
    const start = makeStartEvent(100, 100);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 100, 200));
    expect(down).toHaveBeenCalledOnce();
  });

  it("invokes left for leftward flick beyond threshold", () => {
    const left = vi.fn();
    const handlers = createFlickHandlers({ left });
    const start = makeStartEvent(200, 100);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 100, 100));
    expect(left).toHaveBeenCalledOnce();
  });

  it("invokes right for rightward flick beyond threshold", () => {
    const right = vi.fn();
    const handlers = createFlickHandlers({ right });
    const start = makeStartEvent(100, 100);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 200, 100));
    expect(right).toHaveBeenCalledOnce();
  });

  it("ignores actions when handler is not provided", () => {
    const handlers = createFlickHandlers();
    const start = makeStartEvent(100, 100);
    expect(() => {
      handlers.onStart(start);
      handlers.onEnd(makeEndEvent(start.currentTarget, 200, 100));
    }).not.toThrow();
  });

  it("toggles pressed class on the target element", () => {
    const handlers = createFlickHandlers({ tap: vi.fn() });
    const start = makeStartEvent(100, 100);
    handlers.onStart(start);
    expect(start.currentTarget.classList.add).toHaveBeenCalledWith("pressed");
    handlers.onEnd(makeEndEvent(start.currentTarget, 105, 105));
    expect(start.currentTarget.classList.remove).toHaveBeenCalledWith("pressed");
  });

  it("prefers axis with larger movement", () => {
    const up = vi.fn();
    const left = vi.fn();
    const handlers = createFlickHandlers({ up, left });
    const start = makeStartEvent(100, 200);
    handlers.onStart(start);
    handlers.onEnd(makeEndEvent(start.currentTarget, 130, 100));
    expect(up).toHaveBeenCalledOnce();
    expect(left).not.toHaveBeenCalled();
  });
});
