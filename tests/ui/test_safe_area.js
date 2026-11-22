// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { readSafeAreaInsets, formatSafeAreaInsets } from "../../ui/utils/safe-area.ts";

describe("readSafeAreaInsets", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("env() が解決できない環境では全辺 0 を返し、計測用要素を残さない", () => {
    expect(readSafeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(document.body.children).toHaveLength(0);
  });
});

describe("formatSafeAreaInsets", () => {
  it("上右下左の順で出力する", () => {
    expect(formatSafeAreaInsets({ top: 59, right: 0, bottom: 34, left: 0 })).toBe("T59 R0 B34 L0");
  });
});
