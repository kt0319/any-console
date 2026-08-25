// @ts-check
import { describe, it, expect } from "vitest";
import { formatSize, formatRelativeTime, formatClockTime, formatClockDateTime, formatMinutesAgo, formatDuration, truncateTail, jobCommandPreview, displayUrl } from "../../ui/utils/format.ts";
import { JOB_COMMAND_PREVIEW_MAX } from "../../ui/utils/constants.ts";

describe("displayUrl", () => {
  it("https://を省く", () => {
    expect(displayUrl("https://example.com/foo")).toBe("example.com/foo");
  });

  it("http://を省く", () => {
    expect(displayUrl("http://localhost:3000/")).toBe("localhost:3000/");
  });

  it("スキームが無ければそのまま", () => {
    expect(displayUrl("example.com")).toBe("example.com");
  });

  it("null/undefinedは空文字", () => {
    expect(displayUrl(null)).toBe("");
    expect(displayUrl(undefined)).toBe("");
  });
});

describe("truncateTail", () => {
  it("上限以内はそのまま返す", () => {
    expect(truncateTail("abc", 5)).toBe("abc");
    expect(truncateTail("abcde", 5)).toBe("abcde");
  });

  it("超過分は切り詰めて...を付ける", () => {
    expect(truncateTail("abcdef", 5)).toBe("abcde...");
  });

  it("null/undefinedは空文字", () => {
    expect(truncateTail(null, 5)).toBe("");
    expect(truncateTail(undefined, 5)).toBe("");
  });
});

describe("jobCommandPreview", () => {
  it("コマンドをJOB_COMMAND_PREVIEW_MAXで切り詰める", () => {
    const long = "x".repeat(JOB_COMMAND_PREVIEW_MAX + 10);
    expect(jobCommandPreview(long, "job")).toBe("x".repeat(JOB_COMMAND_PREVIEW_MAX) + "...");
    expect(jobCommandPreview("echo hi", "job")).toBe("echo hi");
  });

  it("コマンドが無ければジョブ名でフォールバック", () => {
    expect(jobCommandPreview("", "my-job")).toBe("my-job");
    expect(jobCommandPreview(null, "my-job")).toBe("my-job");
  });
});

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
    expect(formatRelativeTime(now - 3000)).toBe("now");
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

describe("formatClockTime", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatClockTime(null)).toBe("");
    expect(formatClockTime(undefined)).toBe("");
  });

  it("returns a HH:MM:SS shaped local time string", () => {
    const epoch = Math.floor(Date.now() / 1000);
    expect(formatClockTime(epoch)).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe("formatClockDateTime", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatClockDateTime(null)).toBe("");
    expect(formatClockDateTime(undefined)).toBe("");
  });

  it("returns a M/D HH:MM:SS shaped local date-time string", () => {
    const epoch = Math.floor(Date.now() / 1000);
    expect(formatClockDateTime(epoch)).toMatch(/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/);
  });
});

describe("formatMinutesAgo", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatMinutesAgo(null)).toBe("");
    expect(formatMinutesAgo(undefined)).toBe("");
  });

  it("returns 'just now' for under 1 minute", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMinutesAgo(now)).toBe("just now");
    expect(formatMinutesAgo(now - 30)).toBe("just now");
  });

  it("formats minutes under an hour", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMinutesAgo(now - 60)).toBe("1m ago");
    expect(formatMinutesAgo(now - 60 * 45)).toBe("45m ago");
  });

  it("formats hours under a day", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMinutesAgo(now - 3600 * 2)).toBe("2h ago");
    expect(formatMinutesAgo(now - 3600 * 23)).toBe("23h ago");
  });

  it("formats days for 1 day or more", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMinutesAgo(now - 86400 * 3)).toBe("3d ago");
  });
});

describe("formatDuration", () => {
  it("returns empty string for null/undefined/negative", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(-1)).toBe("");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(3)).toBe("3s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("formats minutes under an hour as m + s", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("formats hours as h + m", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3723)).toBe("1h 2m");
  });
});
