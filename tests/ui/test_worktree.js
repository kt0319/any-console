import { describe, it, expect } from "vitest";
import { worktreeBranchLabel, worktreeConfirmLabel, removeWorktreeConfirmMessage, workspaceDisplayName } from "../../ui/utils/worktree.ts";

describe("worktreeBranchLabel", () => {
  it("returns the branch name as-is (単独表示用、縦線は付与しない)", () => {
    expect(worktreeBranchLabel("feature/x")).toBe("feature/x");
  });

  it("returns empty string for missing branch", () => {
    expect(worktreeBranchLabel("")).toBe("");
    expect(worktreeBranchLabel(undefined)).toBe("");
  });
});

describe("worktreeConfirmLabel", () => {
  it("ワークスペース一覧のworktreeエントリはworktree_branchを優先する", () => {
    expect(worktreeConfirmLabel({ worktree_branch: "feature/x", name: "proj-feature-x", path: "/tmp/wt" })).toBe("feature/x");
  });

  it("ブランチ一覧のworktree（branch/pathのみ）はbranchを使う", () => {
    expect(worktreeConfirmLabel({ branch: "feature/x", path: "/tmp/wt" })).toBe("feature/x");
  });

  it("ブランチ名が無ければname、それも無ければpathへフォールバックする", () => {
    expect(worktreeConfirmLabel({ name: "proj-feature-x", path: "/tmp/wt" })).toBe("proj-feature-x");
    expect(worktreeConfirmLabel({ path: "/tmp/wt" })).toBe("/tmp/wt");
    expect(worktreeConfirmLabel(undefined)).toBe("");
  });
});

describe("removeWorktreeConfirmMessage", () => {
  it("何が起きるか（ディレクトリ削除・取り消し不可）を明示した文言を作る", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone.',
    );
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
