// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { readViewportUnitHeights } from "../../ui/utils/viewport-units.ts";

describe("readViewportUnitHeights", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("vh / lvh / svh / dvh の順で出力し、計測用要素を残さない", () => {
    expect(readViewportUnitHeights()).toMatch(/^vh \d+ \/ lvh \d+ \/ svh \d+ \/ dvh \d+$/);
    expect(document.body.children).toHaveLength(0);
  });
});

describe("readLargeViewportHeightPx", () => {
  it("数値を返し、計測用要素を残さない", async () => {
    const { readLargeViewportHeightPx } = await import("../../ui/utils/viewport-units.ts");
    expect(Number.isFinite(readLargeViewportHeightPx())).toBe(true);
    expect(document.body.children).toHaveLength(0);
  });
});
