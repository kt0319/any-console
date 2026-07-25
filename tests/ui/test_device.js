// @ts-check
import { describe, it, expect } from "vitest";
import { isMobileUserAgent } from "../../ui/utils/device.js";

describe("isMobileUserAgent", () => {
  it("detects iPhone", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1")).toBe(true);
  });

  it("detects iPad", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/604.1")).toBe(true);
  });

  it("detects Android", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120.0")).toBe(true);
  });

  it("returns false for desktop macOS", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36")).toBe(false);
  });

  it("returns false for desktop Windows", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0")).toBe(false);
  });

  it("returns false for desktop Linux", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0")).toBe(false);
  });

  it("returns false for empty/missing user agent", () => {
    expect(isMobileUserAgent("")).toBe(false);
    // @ts-expect-error intentional: exercising the undefined-input fallback
    expect(isMobileUserAgent(undefined)).toBe(false);
  });
});
