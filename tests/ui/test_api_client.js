// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of pure functions from api-client.js ──

function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

function getActionFailureMessage(data, fallback = "unknown error") {
  if (!data || typeof data !== "object") return fallback;
  // simplified: inline toDisplayMessage logic for stderr/stdout/detail
  if (data.stderr) return typeof data.stderr === "string" ? data.stderr : fallback;
  if (data.stdout) return typeof data.stdout === "string" ? data.stdout : fallback;
  if (data.detail) return typeof data.detail === "string" ? data.detail : fallback;
  return fallback;
}

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
