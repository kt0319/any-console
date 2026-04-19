// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { workspaceApiPath, getActionFailureMessage } from "../../ui/utils/endpoints.js";

// ── Tests ──

describe("workspaceApiPath", () => {
  it("builds basic path", () => {
    assert.equal(workspaceApiPath("myrepo"), "/workspaces/myrepo");
  });

  it("appends subpath", () => {
    assert.equal(workspaceApiPath("myrepo", "/branches"), "/workspaces/myrepo/branches");
  });

  it("encodes special characters", () => {
    assert.equal(workspaceApiPath("my repo"), "/workspaces/my%20repo");
  });

  it("encodes slashes in workspace name", () => {
    assert.equal(workspaceApiPath("a/b"), "/workspaces/a%2Fb");
  });

  it("handles empty workspace name", () => {
    assert.equal(workspaceApiPath(""), "/workspaces/");
  });
});

describe("getActionFailureMessage", () => {
  it("returns fallback for null", () => {
    assert.equal(getActionFailureMessage(null), "unknown error");
  });

  it("returns fallback for string", () => {
    assert.equal(getActionFailureMessage("not an object"), "unknown error");
  });

  it("returns stderr if present", () => {
    assert.equal(getActionFailureMessage({ stderr: "error output" }), "error output");
  });

  it("returns stdout if no stderr", () => {
    assert.equal(getActionFailureMessage({ stdout: "standard output" }), "standard output");
  });

  it("returns detail if no stderr/stdout", () => {
    assert.equal(getActionFailureMessage({ detail: "detail msg" }), "detail msg");
  });

  it("uses custom fallback", () => {
    assert.equal(getActionFailureMessage({}, "custom fallback"), "custom fallback");
  });
});
