import { describe, it, expect } from "vitest";
import { generateHexToken } from "../../ui/utils/token.ts";

describe("generateHexToken", () => {
  it("bytes*2 文字の16進文字列を返す", () => {
    const t = generateHexToken(32);
    expect(t).toHaveLength(64);
    expect(t).toMatch(/^[0-9a-f]+$/);
  });

  it("呼ぶたびに異なる値を返す", () => {
    expect(generateHexToken(16)).not.toBe(generateHexToken(16));
  });
});
