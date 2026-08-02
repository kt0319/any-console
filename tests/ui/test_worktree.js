import { describe, it, expect } from "vitest";
import { worktreeBranchLabel, workspaceDisplayName } from "../../ui/utils/worktree.js";

describe("worktreeBranchLabel", () => {
  it("returns the branch name as-is (単独表示用、縦線は付与しない)", () => {
    expect(worktreeBranchLabel("feature/x")).toBe("feature/x");
  });

  it("returns empty string for missing branch", () => {
    expect(worktreeBranchLabel("")).toBe("");
    expect(worktreeBranchLabel(undefined)).toBe("");
  });
});

describe("workspaceDisplayName", () => {
  it("formats a worktree as 'base | branch'", () => {
    const ws = { name: "proj-feature-x", worktree: true, worktree_base: "proj", worktree_branch: "feature/x" };
    expect(workspaceDisplayName(ws)).toBe("proj | feature/x");
  });

  it("falls back to the branch name only when base is missing", () => {
    const ws = { name: "x", worktree: true, worktree_branch: "feature/x" };
    expect(workspaceDisplayName(ws)).toBe("feature/x");
  });

  it("returns the plain name for non-worktree workspaces", () => {
    expect(workspaceDisplayName({ name: "proj" })).toBe("proj");
  });

  it("returns empty string for nullish input", () => {
    expect(workspaceDisplayName(undefined)).toBe("");
  });
});
