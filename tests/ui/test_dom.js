// @ts-check
import { describe, it, expect } from "vitest";
import { isEditableTarget, isEditableOrDialogTarget, restartTapBounce } from "../../ui/utils/dom.js";

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

describe("isEditableOrDialogTarget", () => {
  it("編集可能要素はtrue", () => {
    expect(isEditableOrDialogTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableOrDialogTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("ダイアログ内の要素はtrue", () => {
    const el = { tagName: "BUTTON", closest: (sel) => (sel === "[role='dialog']" ? {} : null) };
    expect(isEditableOrDialogTarget(el)).toBe(true);
  });
  it("編集不可・ダイアログ外はfalse", () => {
    expect(isEditableOrDialogTarget({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isEditableOrDialogTarget(null)).toBe(false);
  });
  it("closestを持たない要素（SVG等の疑似ターゲット）でも落ちない", () => {
    expect(isEditableOrDialogTarget({ tagName: "DIV" })).toBe(false);
  });
});

describe("restartTapBounce", () => {
  it("tap-bounceを外し、reflowを挟んでから付け直す（アニメーション再始動）", () => {
    const calls = [];
    let offsetRead = false;
    const el = {
      classList: {
        remove: (cls) => calls.push(["remove", cls]),
        add: (cls) => calls.push(["add", cls]),
      },
      get offsetWidth() {
        offsetRead = true;
        calls.push(["reflow"]);
        return 0;
      },
    };
    restartTapBounce(/** @type {any} */ (el));
    expect(offsetRead).toBe(true);
    expect(calls).toEqual([["remove", "tap-bounce"], ["reflow"], ["add", "tap-bounce"]]);
  });
});
