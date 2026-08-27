import { describe, it, expect } from "vitest";
import {
  dispatchWorkspaceLabel,
  dispatchBaseWorkspaceLabel,
  dispatchJobLabel,
  dispatchBranchLabel,
  resolveDispatchJobLabel,
} from "../../ui/utils/dispatch-request.ts";

describe("dispatchWorkspaceLabel", () => {
  it("effective_workspace（worktree解決済み）を優先する", () => {
    expect(dispatchWorkspaceLabel({ effective_workspace: "ws:feature/x", workspace: "ws" })).toBe("ws:feature/x");
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

describe("dispatchBaseWorkspaceLabel", () => {
  it("worktreeのeffective_workspaceからベース名を取り出す（履歴を元のディレクトリと共有するため）", () => {
    expect(dispatchBaseWorkspaceLabel({ effective_workspace: "ws:feature/x", workspace: "ws" })).toBe("ws");
  });

  it("worktreeでなければdispatchWorkspaceLabelと同じ値", () => {
    expect(dispatchBaseWorkspaceLabel({ workspace: "ws" })).toBe("ws");
  });

  it("request未指定は空文字", () => {
    expect(dispatchBaseWorkspaceLabel(null)).toBe("");
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

describe("dispatchBranchLabel", () => {
  it("branchをそのまま返す", () => {
    expect(dispatchBranchLabel({ branch: "feature/login-fix" })).toBe("feature/login-fix");
  });

  it("未指定は空文字", () => {
    expect(dispatchBranchLabel({})).toBe("");
    expect(dispatchBranchLabel(null)).toBe("");
  });
});

describe("resolveDispatchJobLabel", () => {
  const allJobs = { ws1: { job_1: { label: "Claude Worker" } } };

  it("allJobsからjob keyに対応するlabelを解決する", () => {
    expect(resolveDispatchJobLabel({ workspace: "ws1", job: "job_1" }, allJobs)).toBe("Claude Worker");
  });

  it("既定ジョブ（terminal）・job未指定は解決を試みず空文字", () => {
    expect(resolveDispatchJobLabel({ workspace: "ws1", job: "terminal" }, allJobs)).toBe("");
    expect(resolveDispatchJobLabel({ workspace: "ws1" }, allJobs)).toBe("");
  });

  it("ワークスペース違い・未知のjob keyはlabelが引けず空文字（job idをそのまま出さない）", () => {
    expect(resolveDispatchJobLabel({ workspace: "other-ws", job: "job_1" }, allJobs)).toBe("");
    expect(resolveDispatchJobLabel({ workspace: "ws1", job: "unknown_job" }, allJobs)).toBe("");
  });

  it("allJobs未取得（起動直後等）でも空文字", () => {
    expect(resolveDispatchJobLabel({ workspace: "ws1", job: "job_1" }, null)).toBe("");
    expect(resolveDispatchJobLabel({ workspace: "ws1", job: "job_1" }, undefined)).toBe("");
  });
});
