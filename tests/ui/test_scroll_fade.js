import { describe, it, expect } from "vitest";
import { scrollFadeMaskImage } from "../../ui/utils/scroll-fade.ts";

describe("scrollFadeMaskImage", () => {
  it("両端ともスクロール不可ならmaskを解除する", () => {
    expect(scrollFadeMaskImage(false, false, 24)).toBe("none");
  });

  it("右にだけスクロール可能なら右端だけフェードする", () => {
    expect(scrollFadeMaskImage(false, true, 24)).toBe(
      "linear-gradient(to right, black 0, black calc(100% - 24px), transparent)",
    );
  });

  it("左にだけスクロール可能なら左端だけフェードする", () => {
    expect(scrollFadeMaskImage(true, false, 24)).toBe(
      "linear-gradient(to right, transparent, black 24px, black 100%)",
    );
  });

  it("両端スクロール可能なら両端フェードする", () => {
    expect(scrollFadeMaskImage(true, true, 24)).toBe(
      "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
    );
  });
});
