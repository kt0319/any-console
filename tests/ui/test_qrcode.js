// @ts-check
import { describe, it, expect } from "vitest";
import { generateQrSvg } from "../../ui/utils/qrcode.ts";

describe("generateQrSvg", () => {
  it("returns empty string for empty input", () => {
    expect(generateQrSvg("")).toBe("");
  });

  it("returns a scalable svg markup string", () => {
    const svg = generateQrSvg("https://example.com/pair/pr_abc123?t=sometoken");
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect(svg).toContain("</svg>");
  });

  it("encodes different text into different markup", () => {
    const a = generateQrSvg("https://example.com/pair/pr_a?t=aaaa");
    const b = generateQrSvg("https://example.com/pair/pr_b?t=bbbb");
    expect(a).not.toBe(b);
  });

  it("produces deterministic output for the same input", () => {
    const url = "https://myhost.tail1234.ts.net/pair/pr_abc123?t=sometoken";
    expect(generateQrSvg(url)).toBe(generateQrSvg(url));
  });
});
