// @ts-check
import { describe, it, expect } from "vitest";
import { parsePairUrl, formatPairingCountdown } from "../../ui/utils/pairing.js";

describe("parsePairUrl", () => {
  it("parses id and token from a pairing url", () => {
    expect(parsePairUrl("/pair/pr_abc123", "?t=sometoken")).toEqual({ id: "pr_abc123", token: "sometoken" });
  });

  it("returns empty token when query is missing", () => {
    expect(parsePairUrl("/pair/pr_abc123", "")).toEqual({ id: "pr_abc123", token: "" });
  });

  it("returns null for unrelated paths", () => {
    expect(parsePairUrl("/", "")).toBeNull();
    expect(parsePairUrl("/settings", "")).toBeNull();
  });

  it("returns null for an empty pathname", () => {
    expect(parsePairUrl("", "")).toBeNull();
  });

  it("returns null for a bare /pair/ with no id", () => {
    expect(parsePairUrl("/pair/", "")).toBeNull();
  });

  it("rejects unsafe characters in the id segment", () => {
    expect(parsePairUrl("/pair/../etc/passwd", "")).toBeNull();
  });

  it("ignores extra query params", () => {
    expect(parsePairUrl("/pair/pr_x", "?foo=bar&t=tok&baz=1")).toEqual({ id: "pr_x", token: "tok" });
  });
});

describe("formatPairingCountdown", () => {
  it("formats seconds under a minute", () => {
    expect(formatPairingCountdown(45)).toBe("0:45");
  });

  it("pads single-digit seconds", () => {
    expect(formatPairingCountdown(5)).toBe("0:05");
  });

  it("formats minutes and seconds", () => {
    expect(formatPairingCountdown(90)).toBe("1:30");
  });

  it("clamps negative values to zero", () => {
    expect(formatPairingCountdown(-5)).toBe("0:00");
  });

  it("floors fractional seconds", () => {
    expect(formatPairingCountdown(12.9)).toBe("0:12");
  });

  it("treats NaN as zero", () => {
    expect(formatPairingCountdown(NaN)).toBe("0:00");
  });
});
