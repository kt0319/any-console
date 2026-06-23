// @ts-check
import { describe, it, expect } from "vitest";
import { isEditableTarget } from "../../ui/utils/dom.js";

describe("isEditableTarget", () => {
  it("true for INPUT/TEXTAREA elements", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
  });
  it("true for contentEditable host", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("false for ordinary elements", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});
