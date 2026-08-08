// @ts-check
import { describe, it, expect } from "vitest";
import { workspaceDownloadPath, workspaceGitDiscardPath } from "../../ui/utils/endpoints.js";
import { safeFlagLoad, safeFlagSave, safeJsonLoad, safeJsonSave } from "../../ui/utils/storage.js";

// ── Tests ──

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

describe("safeJsonSave", () => {
  it("stores the JSON-stringified value", () => {
    const stored = {};
    globalThis.localStorage = { setItem: (k, v) => { stored[k] = v; } };
    safeJsonSave("key", { a: 1 });
    expect(stored.key).toBe(JSON.stringify({ a: 1 }));
  });

  it("swallows quota errors", () => {
    globalThis.localStorage = { setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => safeJsonSave("key", [1, 2])).not.toThrow();
  });
});

describe("safeFlagLoad", () => {
  it('returns true only when stored value is "1"', () => {
    globalThis.localStorage = { getItem: () => "1" };
    expect(safeFlagLoad("key")).toBe(true);
    globalThis.localStorage = { getItem: () => "0" };
    expect(safeFlagLoad("key")).toBe(false);
    globalThis.localStorage = { getItem: () => null };
    expect(safeFlagLoad("key")).toBe(false);
  });

  it("returns false when localStorage.getItem throws", () => {
    globalThis.localStorage = { getItem: () => { throw new Error("SecurityError"); } };
    expect(safeFlagLoad("key")).toBe(false);
  });
});

describe("safeFlagSave", () => {
  it('stores "1" for true and removes the key for false', () => {
    const stored = { key: "1" };
    globalThis.localStorage = {
      setItem: (k, v) => { stored[k] = v; },
      removeItem: (k) => { delete stored[k]; },
    };
    safeFlagSave("key", false);
    expect(stored.key).toBeUndefined();
    safeFlagSave("key", true);
    expect(stored.key).toBe("1");
  });

  it("swallows quota errors", () => {
    globalThis.localStorage = { setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => safeFlagSave("key", true)).not.toThrow();
  });
});
