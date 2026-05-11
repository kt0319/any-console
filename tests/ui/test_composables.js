// @ts-check
import { describe, it, expect } from "vitest";
import { buildFileList } from "../../ui/composables/useGitDiff.js";
import { buildWebSocketUrl } from "../../ui/utils/terminal-ws.js";
import { extractApiError } from "../../ui/utils/constants.js";

// ── Tests ──

describe("buildFileList", () => {
  it("maps files with path and status", () => {
    const files = [
      { path: "src/app.js", status: "M", insertions: 10, deletions: 3 },
      { path: "README.md", status: "A", insertions: 5, deletions: 0 },
    ];
    const result = buildFileList(files);
    expect(result.length).toBe(2);
    expect(result[0].path).toBe("src/app.js");
    expect(result[0].status).toBe("M");
    expect(result[0].insertions).toBe(10);
    expect(result[0].deletions).toBe(3);
    expect(result[1].status).toBe("A");
  });

  it("falls back to name when path is missing", () => {
    const files = [{ name: "file.txt", status: "D" }];
    const result = buildFileList(files);
    expect(result[0].path).toBe("file.txt");
    expect(result[0].status).toBe("D");
  });

  it("defaults status to M when missing", () => {
    const files = [{ path: "file.txt" }];
    const result = buildFileList(files);
    expect(result[0].status).toBe("M");
  });

  it("handles null/undefined files", () => {
    expect(buildFileList(null)).toEqual([]);
    expect(buildFileList(undefined)).toEqual([]);
    expect(buildFileList([])).toEqual([]);
  });

  it("preserves undefined insertions/deletions", () => {
    const files = [{ path: "a.js" }];
    const result = buildFileList(files);
    expect(result[0].insertions).toBe(undefined);
    expect(result[0].deletions).toBe(undefined);
  });
});

describe("buildWebSocketUrl", () => {
  it("builds basic url without dimensions", () => {
    const url = buildWebSocketUrl("wss:", "localhost:8888", "abc123", null, null);
    expect(url).toBe("wss://localhost:8888/terminal/ws/abc123");
  });

  it("appends cols and rows when provided", () => {
    const url = buildWebSocketUrl("ws:", "pi:8888", "sess1", 80, 24);
    expect(url).toBe("ws://pi:8888/terminal/ws/sess1?cols=80&rows=24");
  });

  it("does not append cols/rows when only cols is provided", () => {
    const url = buildWebSocketUrl("ws:", "host", "s", 80, null);
    expect(!url.includes("cols=")).toBeTruthy();
  });

  it("does not include token in url", () => {
    const url = buildWebSocketUrl("wss:", "host", "s", 80, 24);
    expect(!url.includes("token=")).toBeTruthy();
  });
});

describe("extractApiError", () => {
  it("returns detail from data", () => {
    expect(extractApiError({ detail: "not found" })).toBe("not found");
  });

  it("returns message from data", () => {
    expect(extractApiError({ message: "server error" })).toBe("server error");
  });

  it("prefers detail over message", () => {
    expect(extractApiError({ detail: "d", message: "m" })).toBe("d");
  });

  it("returns fallback for null data", () => {
    expect(extractApiError(null, "fail")).toBe("fail");
  });

  it("returns default fallback", () => {
    expect(extractApiError(null)).toBe("An error occurred");
  });

  it("returns fallback for empty object", () => {
    expect(extractApiError({}, "oops")).toBe("oops");
  });
});
