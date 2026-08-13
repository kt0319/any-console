// @ts-check
import { describe, it, expect } from "vitest";
import { isPastDragThreshold, createTouchTracker } from "../../ui/utils/gesture.ts";

describe("isPastDragThreshold", () => {
  it("returns false when within threshold", () => {
    expect(isPastDragThreshold(3, 4, 10)).toBe(false);
  });

  it("returns true when distance exceeds threshold", () => {
    expect(isPastDragThreshold(10, 10, 10)).toBe(true);
  });

  it("uses squared distance (3,4,5 triangle)", () => {
    expect(isPastDragThreshold(3, 4, 5)).toBe(false);
    expect(isPastDragThreshold(3, 4, 4)).toBe(true);
  });

  it("handles negative deltas", () => {
    expect(isPastDragThreshold(-10, -10, 5)).toBe(true);
  });
});

describe("createTouchTracker", () => {
  it("tracks delta from start to delta call (mouse event)", () => {
    const t = createTouchTracker();
    t.start({ clientX: 100, clientY: 200 });
    expect(t.delta({ clientX: 110, clientY: 195 })).toEqual({ dx: 10, dy: -5 });
  });

  it("uses touches[0] for touch events", () => {
    const t = createTouchTracker();
    t.start({ touches: [{ clientX: 50, clientY: 60 }] });
    expect(
      t.delta({ changedTouches: [{ clientX: 55, clientY: 70 }] }),
    ).toEqual({ dx: 5, dy: 10 });
  });

  it("defaults missing coordinates to 0", () => {
    const t = createTouchTracker();
    t.start({});
    expect(t.delta({})).toEqual({ dx: 0, dy: 0 });
  });
});
