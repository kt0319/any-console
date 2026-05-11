// @ts-check
import { describe, it, expect } from "vitest";
import { workspaceApiPath, getActionFailureMessage } from "../../ui/utils/endpoints.js";

// ── Tests ──

describe("workspaceApiPath", () => {
  it("builds basic path", () => {
    expect(workspaceApiPath("myrepo")).toBe("/workspaces/myrepo");
  });

  it("appends subpath", () => {
    expect(workspaceApiPath("myrepo", "/branches")).toBe("/workspaces/myrepo/branches");
  });

  it("encodes special characters", () => {
    expect(workspaceApiPath("my repo")).toBe("/workspaces/my%20repo");
  });

  it("encodes slashes in workspace name", () => {
    expect(workspaceApiPath("a/b")).toBe("/workspaces/a%2Fb");
  });

  it("handles empty workspace name", () => {
    expect(workspaceApiPath("")).toBe("/workspaces/");
  });
});

describe("getActionFailureMessage", () => {
  it("returns fallback for null", () => {
    expect(getActionFailureMessage(null)).toBe("unknown error");
  });

  it("returns fallback for string", () => {
    expect(getActionFailureMessage("not an object")).toBe("unknown error");
  });

  it("returns stderr if present", () => {
    expect(getActionFailureMessage({ stderr: "error output" })).toBe("error output");
  });

  it("returns stdout if no stderr", () => {
    expect(getActionFailureMessage({ stdout: "standard output" })).toBe("standard output");
  });

  it("returns detail if no stderr/stdout", () => {
    expect(getActionFailureMessage({ detail: "detail msg" })).toBe("detail msg");
  });

  it("uses custom fallback", () => {
    expect(getActionFailureMessage({}, "custom fallback")).toBe("custom fallback");
  });
});
