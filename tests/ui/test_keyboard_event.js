// @ts-check
import { describe, it, expect, vi } from "vitest";
import {
  MODIFIER_KEYS,
  isComposingEvent,
  isHardwareKeyboardEvent,
  runUnlessComposing,
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

describe("runUnlessComposing", () => {
  const makeEvent = (props) => ({ preventDefault: vi.fn(), ...props });

  it("通常のキー入力では preventDefault して action を実行する", () => {
    const action = vi.fn();
    const e = makeEvent({ keyCode: 13, isComposing: false });
    runUnlessComposing(e, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["isComposing", { isComposing: true, keyCode: 13 }],
    ["keyCode 229（Safari は変換確定の Enter が isComposing=false で届く）", { isComposing: false, keyCode: 229 }],
  ])("IME 変換中（%s）は action も preventDefault も行わない", (_label, props) => {
    const action = vi.fn();
    const e = makeEvent(props);
    runUnlessComposing(e, action);
    expect(action).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
