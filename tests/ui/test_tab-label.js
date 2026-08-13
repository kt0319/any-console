import { describe, it, expect } from "vitest";
import { workspaceBranchLabel, tabTitleLabel } from "../../ui/utils/tab-label.ts";

describe("workspaceBranchLabel", () => {
  const allWorkspaces = [
    { name: "any-console", branch: "main" },
    { name: "no-branch-ws" },
    { name: "proj-feature-x", worktree: true, worktree_base: "proj", worktree_branch: "feature/x" },
  ];

  it("appends the branch with a pipe separator for a normal workspace", () => {
    expect(workspaceBranchLabel("any-console", allWorkspaces)).toBe("any-console | main");
  });

  it("returns the plain name when branch is missing", () => {
    expect(workspaceBranchLabel("no-branch-ws", allWorkspaces)).toBe("no-branch-ws");
  });

  it("uses workspaceDisplayName for worktree workspaces", () => {
    expect(workspaceBranchLabel("proj-feature-x", allWorkspaces)).toBe("proj | feature/x");
  });

  it("returns the name unchanged when the workspace is not found", () => {
    expect(workspaceBranchLabel("unknown", allWorkspaces)).toBe("unknown");
  });
});

describe("tabTitleLabel", () => {
  const allWorkspaces = [{ name: "any-console", branch: "main" }];

  it("joins workspace | branch and job name", () => {
    const tab = { workspace: "any-console", jobName: "claude" };
    expect(tabTitleLabel(tab, allWorkspaces)).toBe("any-console | main | claude");
  });

  it("prefers jobLabel over jobName", () => {
    const tab = { workspace: "any-console", jobLabel: "Claude Code", jobName: "claude" };
    expect(tabTitleLabel(tab, allWorkspaces)).toBe("any-console | main | Claude Code");
  });

  it("omits the job segment when absent", () => {
    const tab = { workspace: "any-console" };
    expect(tabTitleLabel(tab, allWorkspaces)).toBe("any-console | main");
  });

  it("returns empty string for a missing tab", () => {
    expect(tabTitleLabel(undefined, allWorkspaces)).toBe("");
  });
});
