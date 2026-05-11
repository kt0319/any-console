// @ts-check
import { describe, it, expect } from "vitest";
import { toDisplayMessage, formatCommitTime, buildWorkspaceChangeSummaryHtml, VALID_ICON_COLOR, isImageDataIcon, faviconUrl } from "../../ui/utils/display.js";
import { workspaceDownloadPath, workspaceGitDiscardPath } from "../../ui/utils/endpoints.js";
import { safeJsonLoad } from "../../ui/utils/storage.js";

// ── Tests ──

describe("toDisplayMessage", () => {
  it("returns string as-is", () => {
    expect(toDisplayMessage("hello")).toBe("hello");
  });

  it("returns fallback for null", () => {
    expect(toDisplayMessage(null, "fallback")).toBe("fallback");
  });

  it("returns fallback for undefined", () => {
    expect(toDisplayMessage(undefined, "fallback")).toBe("fallback");
  });

  it("converts number to string", () => {
    expect(toDisplayMessage(42)).toBe("42");
  });

  it("converts boolean to string", () => {
    expect(toDisplayMessage(true)).toBe("true");
  });

  it("extracts message from Error", () => {
    expect(toDisplayMessage(new Error("oops"))).toBe("oops");
  });

  it("extracts detail from object", () => {
    expect(toDisplayMessage({ detail: "some detail" })).toBe("some detail");
  });

  it("extracts message from object", () => {
    expect(toDisplayMessage({ message: "msg here" })).toBe("msg here");
  });

  it("extracts error from object", () => {
    expect(toDisplayMessage({ error: "err" })).toBe("err");
  });

  it("extracts stderr from object", () => {
    expect(toDisplayMessage({ stderr: "stderr output" })).toBe("stderr output");
  });

  it("joins array items with /", () => {
    expect(toDisplayMessage(["a", "b"])).toBe("a / b");
  });

  it("extracts msg from array items", () => {
    expect(toDisplayMessage([{ msg: "x" }, { msg: "y" }])).toBe("x / y");
  });

  it("returns fallback for empty array", () => {
    expect(toDisplayMessage([], "nothing")).toBe("nothing");
  });

  it("returns JSON for unknown object", () => {
    expect(toDisplayMessage({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("detail takes priority over message", () => {
    expect(toDisplayMessage({ detail: "d", message: "m" })).toBe("d");
  });

  it("handles nested detail as array", () => {
    expect(toDisplayMessage({ detail: [{ msg: "a" }] })).toBe("a");
  });
});

describe("formatCommitTime", () => {
  it("returns '-' for empty string", () => {
    expect(formatCommitTime("")).toBe("-");
  });

  it("returns '-' for null", () => {
    expect(formatCommitTime(null)).toBe("-");
  });

  it("formats valid ISO date", () => {
    // Use UTC to make test timezone-independent
    const d = new Date(2024, 0, 15, 9, 30);
    const result = formatCommitTime(d.toISOString());
    expect(result).toMatch(/^2024-01-15/);
  });

  it("returns raw text for invalid date", () => {
    expect(formatCommitTime("not-a-date")).toBe("not-a-date");
  });
});

describe("buildWorkspaceChangeSummaryHtml", () => {
  it("returns empty for null", () => {
    expect(buildWorkspaceChangeSummaryHtml(null)).toBe("");
  });

  it("returns empty for clean workspace", () => {
    expect(buildWorkspaceChangeSummaryHtml({ clean: true })).toBe("");
  });

  it("returns bullet for dirty with no stats", () => {
    expect(buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 0, insertions: 0, deletions: 0 })).toBe("\u25cf");
  });

  it("includes files and insertions", () => {
    const result = buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 3, insertions: 10, deletions: 0 });
    expect(result.includes("3F")).toBeTruthy();
    expect(result.includes("+10")).toBeTruthy();
    expect(!result.includes("-0")).toBeTruthy();
  });

  it("includes all parts", () => {
    const result = buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 2, insertions: 5, deletions: 3 });
    expect(result.includes("2F")).toBeTruthy();
    expect(result.includes("+5")).toBeTruthy();
    expect(result.includes("-3")).toBeTruthy();
  });
});

describe("VALID_ICON_COLOR", () => {
  it("matches 3-digit hex", () => {
    expect(VALID_ICON_COLOR.test("#abc")).toBeTruthy();
  });

  it("matches 6-digit hex", () => {
    expect(VALID_ICON_COLOR.test("#aabbcc")).toBeTruthy();
  });

  it("rejects no hash", () => {
    expect(!VALID_ICON_COLOR.test("aabbcc")).toBeTruthy();
  });

  it("rejects invalid chars", () => {
    expect(!VALID_ICON_COLOR.test("#gggggg")).toBeTruthy();
  });
});

describe("isImageDataIcon", () => {
  it("returns true for data:image/ prefix", () => {
    expect(isImageDataIcon("data:image/png;base64,abc")).toBeTruthy();
  });

  it("returns false for regular string", () => {
    expect(!isImageDataIcon("mdi-home")).toBeTruthy();
  });

  it("returns false for null", () => {
    expect(!isImageDataIcon(null)).toBeTruthy();
  });
});

describe("faviconUrl", () => {
  it("returns empty for empty domain", () => {
    expect(faviconUrl("")).toBe("");
  });

  it("constructs Google favicon URL", () => {
    const result = faviconUrl("example.com");
    expect(result.includes("example.com")).toBeTruthy();
    expect(result.includes("favicons")).toBeTruthy();
  });

  it("encodes special characters", () => {
    const result = faviconUrl("example.com/path?q=1");
    expect(result.includes(encodeURIComponent("example.com/path?q=1"))).toBeTruthy();
  });
});

describe("workspaceDownloadPath", () => {
  it("builds correct download URL", () => {
    expect(workspaceDownloadPath("myws", "dir/file.txt")).toBe(
      "/workspaces/myws/download?path=dir%2Ffile.txt",
    );
  });

  it("encodes workspace name with spaces", () => {
    const result = workspaceDownloadPath("my ws", "file.txt");
    expect(result.startsWith("/workspaces/my%20ws/download")).toBeTruthy();
  });

  it("encodes path with spaces", () => {
    const result = workspaceDownloadPath("ws", "path with spaces/file.txt");
    expect(result.includes(encodeURIComponent("path with spaces/file.txt"))).toBeTruthy();
  });

  it("encodes special characters in path", () => {
    const result = workspaceDownloadPath("ws", "dir/file name & more.txt");
    expect(result.includes("file%20name%20%26%20more.txt")).toBeTruthy();
  });
});

describe("workspaceGitDiscardPath", () => {
  it("builds correct discard URL", () => {
    expect(workspaceGitDiscardPath("myws")).toBe("/workspaces/myws/git/discard");
  });

  it("encodes workspace name with spaces", () => {
    expect(workspaceGitDiscardPath("my ws")).toBe("/workspaces/my%20ws/git/discard");
  });

  it("encodes special characters in workspace name", () => {
    expect(workspaceGitDiscardPath("ws/sub")).toBe("/workspaces/ws%2Fsub/git/discard");
  });
});

describe("safeJsonLoad", () => {
  it("returns parsed value from localStorage", () => {
    globalThis.localStorage = { getItem: () => JSON.stringify({ a: 1 }) };
    expect(safeJsonLoad("key", {})).toEqual({ a: 1 });
  });

  it("returns fallback when key is absent", () => {
    globalThis.localStorage = { getItem: () => null };
    expect(safeJsonLoad("key", [])).toEqual([]);
  });

  it("returns fallback when value is empty string", () => {
    globalThis.localStorage = { getItem: () => "" };
    expect(safeJsonLoad("key", 42)).toEqual(42);
  });

  it("returns fallback on invalid JSON", () => {
    globalThis.localStorage = { getItem: () => "{bad json" };
    expect(safeJsonLoad("key", null)).toEqual(null);
  });

  it("returns fallback when localStorage.getItem throws", () => {
    globalThis.localStorage = { getItem: () => { throw new Error("SecurityError"); } };
    expect(safeJsonLoad("key", "default")).toEqual("default");
  });
});
