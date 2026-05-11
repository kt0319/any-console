// @ts-check
import { describe, it, expect } from "vitest";
import { shouldConfirmBeforeUnload, handleBeforeUnload } from "../../ui/utils/page-unload.js";

describe("shouldConfirmBeforeUnload", () => {
  it("returns false when no tabs are open", () => {
    expect(shouldConfirmBeforeUnload([])).toBe(false);
  });

  it("returns true when at least one tab is open", () => {
    expect(shouldConfirmBeforeUnload([{ id: 1 }])).toBe(true);
  });

  it("returns false for non-array values", () => {
    expect(shouldConfirmBeforeUnload(null)).toBe(false);
    expect(shouldConfirmBeforeUnload(undefined)).toBe(false);
  });
});

describe("handleBeforeUnload", () => {
  it("does nothing when confirmation is unnecessary", () => {
    let prevented = false;
    const event = {
      returnValue: undefined,
      preventDefault() {
        prevented = true;
      },
    };
    expect(handleBeforeUnload(event, [])).toBe(false);
    expect(prevented).toBe(false);
    expect(event.returnValue).toBe(undefined);
  });

  it("prevents unload when tabs are open", () => {
    let prevented = false;
    const event = {
      returnValue: undefined,
      preventDefault() {
        prevented = true;
      },
    };
    expect(handleBeforeUnload(event, [{ id: 1 }])).toBe(true);
    expect(prevented).toBe(true);
    expect(event.returnValue).toBe("");
  });
});
