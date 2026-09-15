import { describe, it, expect } from "vitest";
import { clampSidebarWidth, sidebarMaxWidth } from "../../ui/utils/sidebar-width.ts";

describe("sidebar width", () => {
  it("保存値の破損時は既定幅を使う", () => {
    for (const value of [null, "400", {}, NaN, Infinity]) {
      expect(clampSidebarWidth(value)).toBe(320);
    }
  });
  it("下限・上限と画面の半分に制限する", () => {
    expect(clampSidebarWidth(100, 1200)).toBe(240);
    expect(clampSidebarWidth(900, 1200)).toBe(600);
    expect(clampSidebarWidth(900, 1920)).toBe(640);
    expect(sidebarMaxWidth(769)).toBe(384);
    expect(clampSidebarWidth(350.7)).toBe(351);
  });
});
