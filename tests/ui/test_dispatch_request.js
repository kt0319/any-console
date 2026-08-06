import { describe, it, expect } from "vitest";
import { dispatchWorkspaceLabel, dispatchJobLabel } from "../../ui/utils/dispatch-request.js";

describe("dispatchWorkspaceLabel", () => {
  it("effective_workspace（worktree解決済み）を優先する", () => {
    expect(dispatchWorkspaceLabel({ effective_workspace: "ws [feature/x]", workspace: "ws" })).toBe("ws [feature/x]");
  });

  it("effective_workspaceが無ければworkspace", () => {
    expect(dispatchWorkspaceLabel({ workspace: "ws" })).toBe("ws");
  });

  it("request未指定は空文字", () => {
    expect(dispatchWorkspaceLabel(null)).toBe("");
    expect(dispatchWorkspaceLabel(undefined)).toBe("");
    expect(dispatchWorkspaceLabel({})).toBe("");
  });
});

describe("dispatchJobLabel", () => {
  it("名前付きジョブはそのまま返す", () => {
    expect(dispatchJobLabel({ job: "build" })).toBe("build");
  });

  it("既定ジョブ（terminal）・未指定は空文字", () => {
    expect(dispatchJobLabel({ job: "terminal" })).toBe("");
    expect(dispatchJobLabel({})).toBe("");
    expect(dispatchJobLabel(null)).toBe("");
  });
});
