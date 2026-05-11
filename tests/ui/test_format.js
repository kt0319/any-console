// @ts-check
import { describe, it, expect } from "vitest";
import { formatSize, formatRelativeTime } from "../../ui/utils/format.js";

describe("formatSize", () => {
  it("returns empty string for null", () => {
    expect(formatSize(null)).toBe("");
  });

  it("formats bytes under 1KB as B", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats values under 1MB as KB", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  it("formats values >= 1MB as MB", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 5)).toBe("5.0 MB");
  });
});

describe("formatRelativeTime", () => {
  it("returns empty string for null", () => {
    expect(formatRelativeTime(null)).toBe("");
  });

  it("returns 'now' for under 1 hour", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now)).toBe("now");
    expect(formatRelativeTime(now - 60)).toBe("now");
    expect(formatRelativeTime(now - 3599)).toBe("now");
  });

  it("formats hours under a day", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 3600 * 2)).toBe("2h ago");
    expect(formatRelativeTime(now - 3600 * 23)).toBe("23h ago");
  });

  it("formats days under a week", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 86400 * 3)).toBe("3d ago");
  });

  it("formats weeks under a month", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 86400 * 14)).toBe("2w ago");
  });

  it("formats months under a year", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 86400 * 60)).toBe("2m ago");
  });

  it("formats years for older timestamps", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 86400 * 400)).toBe("1y ago");
  });

  it("treats future timestamps as now", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(formatRelativeTime(future)).toBe("now");
  });
});
