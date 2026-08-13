// @ts-check
import { describe, it, expect } from "vitest";
import {
  MODIFIER_KEYS,
  isComposingEvent,
  isHardwareKeyboardEvent,
} from "../../ui/utils/keyboard-event.ts";

describe("MODIFIER_KEYS", () => {
  it("contains the four standard modifier names", () => {
    expect(MODIFIER_KEYS.has("Shift")).toBe(true);
    expect(MODIFIER_KEYS.has("Control")).toBe(true);
    expect(MODIFIER_KEYS.has("Alt")).toBe(true);
    expect(MODIFIER_KEYS.has("Meta")).toBe(true);
    expect(MODIFIER_KEYS.has("Enter")).toBe(false);
  });
});

describe("isComposingEvent", () => {
  it("true when composingFlag is set", () => {
    expect(isComposingEvent({ keyCode: 65 }, true)).toBe(true);
  });
  it("true when e.isComposing is true", () => {
    expect(isComposingEvent({ isComposing: true })).toBe(true);
  });
  it("true when keyCode is 229 (IME)", () => {
    expect(isComposingEvent({ keyCode: 229 })).toBe(true);
  });
  it("false for a normal keydown", () => {
    expect(isComposingEvent({ keyCode: 65, isComposing: false }, false)).toBe(false);
  });
});

describe("isHardwareKeyboardEvent", () => {
  it("true when e.code has a real value", () => {
    expect(isHardwareKeyboardEvent({ code: "KeyA" })).toBe(true);
    expect(isHardwareKeyboardEvent({ code: "Enter" })).toBe(true);
  });
  it("false when e.code is empty or Unidentified", () => {
    expect(isHardwareKeyboardEvent({ code: "" })).toBe(false);
    expect(isHardwareKeyboardEvent({ code: "Unidentified" })).toBe(false);
    expect(isHardwareKeyboardEvent({})).toBe(false);
    expect(isHardwareKeyboardEvent(null)).toBe(false);
  });
});
