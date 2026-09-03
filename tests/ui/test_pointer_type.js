// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { getLastPointerType } from "../../ui/utils/pointer-type.ts";

function firePointerdown(pointerType) {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  document.dispatchEvent(event);
}

describe("getLastPointerType", () => {
  it("defaults to mouse before any pointerdown is observed", () => {
    expect(getLastPointerType()).toBe("mouse");
  });

  it("updates to touch when a touch pointerdown fires anywhere in the document", () => {
    firePointerdown("touch");
    expect(getLastPointerType()).toBe("touch");
  });

  it("updates back to mouse when a mouse pointerdown fires anywhere in the document", () => {
    firePointerdown("touch");
    firePointerdown("mouse");
    expect(getLastPointerType()).toBe("mouse");
  });

  it("tracks pointerdown on an unrelated element (e.g. a dialog button), not just the terminal", () => {
    const dialogBtn = document.createElement("button");
    document.body.appendChild(dialogBtn);
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    dialogBtn.dispatchEvent(event);
    expect(getLastPointerType()).toBe("touch");
    dialogBtn.remove();
  });
});
