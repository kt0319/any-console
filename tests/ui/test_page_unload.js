// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inline copies of pure functions from ui/utils/page-unload.js
function shouldConfirmBeforeUnload(openTabs) {
  return Array.isArray(openTabs) && openTabs.length > 0;
}

function handleBeforeUnload(event, openTabs) {
  if (!shouldConfirmBeforeUnload(openTabs)) return false;
  event?.preventDefault?.();
  if (event) event.returnValue = "";
  return true;
}

describe("shouldConfirmBeforeUnload", () => {
  it("returns false when no tabs are open", () => {
    assert.equal(shouldConfirmBeforeUnload([]), false);
  });

  it("returns true when at least one tab is open", () => {
    assert.equal(shouldConfirmBeforeUnload([{ id: 1 }]), true);
  });

  it("returns false for non-array values", () => {
    assert.equal(shouldConfirmBeforeUnload(null), false);
    assert.equal(shouldConfirmBeforeUnload(undefined), false);
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
    assert.equal(handleBeforeUnload(event, []), false);
    assert.equal(prevented, false);
    assert.equal(event.returnValue, undefined);
  });

  it("prevents unload when tabs are open", () => {
    let prevented = false;
    const event = {
      returnValue: undefined,
      preventDefault() {
        prevented = true;
      },
    };
    assert.equal(handleBeforeUnload(event, [{ id: 1 }]), true);
    assert.equal(prevented, true);
    assert.equal(event.returnValue, "");
  });
});
