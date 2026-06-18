// @ts-check
import { describe, it, expect } from "vitest";
import { createPendingPromise } from "../../ui/utils/pending-promise.js";

describe("createPendingPromise", () => {
  it("starts with no pending promise", () => {
    const p = createPendingPromise();
    expect(p.pending).toBe(false);
  });

  it("settle resolves the active promise and clears pending", async () => {
    const p = createPendingPromise();
    const promise = p.begin(null);
    expect(p.pending).toBe(true);
    p.settle("done");
    await expect(promise).resolves.toBe("done");
    expect(p.pending).toBe(false);
  });

  it("begin supersedes a prior pending promise with the supersede value", async () => {
    const p = createPendingPromise();
    const first = p.begin(false);
    const second = p.begin(false);
    await expect(first).resolves.toBe(false);
    p.settle(true);
    await expect(second).resolves.toBe(true);
  });

  it("settle is a no-op when nothing is pending", () => {
    const p = createPendingPromise();
    expect(() => p.settle("x")).not.toThrow();
    expect(p.pending).toBe(false);
  });

  it("supersede passes the given value, not a fixed default", async () => {
    const p = createPendingPromise();
    const first = p.begin({ approved: false });
    p.begin({ approved: false });
    await expect(first).resolves.toEqual({ approved: false });
  });
});
