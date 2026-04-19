// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(result.length, 2);
    assert.equal(result[0].path, "src/app.js");
    assert.equal(result[0].status, "M");
    assert.equal(result[0].insertions, 10);
    assert.equal(result[0].deletions, 3);
    assert.equal(result[1].status, "A");
  });

  it("falls back to name when path is missing", () => {
    const files = [{ name: "file.txt", status: "D" }];
    const result = buildFileList(files);
    assert.equal(result[0].path, "file.txt");
    assert.equal(result[0].status, "D");
  });

  it("defaults status to M when missing", () => {
    const files = [{ path: "file.txt" }];
    const result = buildFileList(files);
    assert.equal(result[0].status, "M");
  });

  it("handles null/undefined files", () => {
    assert.deepEqual(buildFileList(null), []);
    assert.deepEqual(buildFileList(undefined), []);
    assert.deepEqual(buildFileList([]), []);
  });

  it("preserves undefined insertions/deletions", () => {
    const files = [{ path: "a.js" }];
    const result = buildFileList(files);
    assert.equal(result[0].insertions, undefined);
    assert.equal(result[0].deletions, undefined);
  });
});

describe("buildWebSocketUrl", () => {
  it("builds basic url without dimensions", () => {
    const url = buildWebSocketUrl("wss:", "localhost:8888", "abc123", "tok", null, null);
    assert.equal(url, "wss://localhost:8888/terminal/ws/abc123?token=tok");
  });

  it("appends cols and rows when provided", () => {
    const url = buildWebSocketUrl("ws:", "pi:8888", "sess1", "t", 80, 24);
    assert.equal(url, "ws://pi:8888/terminal/ws/sess1?token=t&cols=80&rows=24");
  });

  it("encodes token with special characters", () => {
    const url = buildWebSocketUrl("wss:", "host", "s", "a&b=c", null, null);
    assert.ok(url.includes("token=a%26b%3Dc"));
  });

  it("does not append cols/rows when only cols is provided", () => {
    const url = buildWebSocketUrl("ws:", "host", "s", "t", 80, null);
    assert.ok(!url.includes("cols="));
  });
});

describe("extractApiError", () => {
  it("returns detail from data", () => {
    assert.equal(extractApiError({ detail: "not found" }), "not found");
  });

  it("returns message from data", () => {
    assert.equal(extractApiError({ message: "server error" }), "server error");
  });

  it("prefers detail over message", () => {
    assert.equal(extractApiError({ detail: "d", message: "m" }), "d");
  });

  it("returns fallback for null data", () => {
    assert.equal(extractApiError(null, "fail"), "fail");
  });

  it("returns default fallback", () => {
    assert.equal(extractApiError(null), "An error occurred");
  });

  it("returns fallback for empty object", () => {
    assert.equal(extractApiError({}, "oops"), "oops");
  });
});
