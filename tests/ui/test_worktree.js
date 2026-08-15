import { describe, it, expect } from "vitest";
import { worktreeBranchLabel, worktreeConfirmLabel, removeWorktreeConfirmMessage, workspaceDisplayName, findOpenTabsForWorktree, baseWorkspaceName, worktreeWorkspaceName } from "../../ui/utils/worktree.ts";

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

  it("開いているタブが1件ある時はそれも閉じることを単数形で明示する", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" }, { openTabs: 1 })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone. Its open session will also be closed.',
    );
  });

  it("開いているタブ+detachedセッションの合計が複数の時は複数形で明示する", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" }, { openTabs: 1, detachedSessions: 1 })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone. Its open sessions will also be closed.',
    );
  });

  it("dev serverプロセスが検出された時は停止することも明示する（単数）", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" }, { devServers: 1 })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone. Its dev server process will also be stopped.',
    );
  });

  it("dev serverプロセスが複数の時は複数形で明示する", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" }, { devServers: 2 })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone. Its 2 dev server processes will also be stopped.',
    );
  });

  it("セッション・dev server両方ある時は両方明示する", () => {
    expect(removeWorktreeConfirmMessage({ branch: "feature/x", path: "/tmp/wt" }, { openTabs: 1, devServers: 1 })).toBe(
      'Remove worktree "feature/x"? The working tree directory will be deleted. This cannot be undone. Its open session will also be closed. Its dev server process will also be stopped.',
    );
  });
});

describe("findOpenTabsForWorktree", () => {
  const tabs = [
    { id: 1, workspace: "app" },
    { id: 2, workspace: "app-feature-x" },
    { id: 3, workspace: null },
  ];

  it("GitChangeBranch.vue経由（wt.workspaceが登録名）のタブを見つける", () => {
    const found = findOpenTabsForWorktree(tabs, { branch: "feature/x", path: "/tmp/wt", workspace: "app-feature-x" });
    expect(found).toEqual([tabs[1]]);
  });

  it("WorkspaceOpen.vue経由（wt自体が登録ワークスペース、wt.nameが登録名）のタブを見つける", () => {
    const found = findOpenTabsForWorktree(tabs, { name: "app-feature-x", worktree: true });
    expect(found).toEqual([tabs[1]]);
  });

  it("該当するタブが無ければ空配列を返す", () => {
    expect(findOpenTabsForWorktree(tabs, { workspace: "no-such-ws" })).toEqual([]);
  });

  it("wt自体にworkspace/nameが無ければ空配列を返す", () => {
    expect(findOpenTabsForWorktree(tabs, { path: "/tmp/wt" })).toEqual([]);
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

describe("baseWorkspaceName", () => {
  it("worktree名（\"base:branch\"形式）からベース名を取り出す", () => {
    expect(baseWorkspaceName("app:feature/x")).toBe("app");
  });

  it("スラッシュを含むブランチ名でも取り出せる", () => {
    expect(baseWorkspaceName("dw-joy-frontend:feature/DW_JOY_DEV-975")).toBe("dw-joy-frontend");
  });

  it("worktreeでなければそのまま返す", () => {
    expect(baseWorkspaceName("app")).toBe("app");
  });

  it("コロンの前後どちらかが空ならworktree形式とみなさずそのまま返す", () => {
    expect(baseWorkspaceName(":no-base")).toBe(":no-base");
    expect(baseWorkspaceName("no-branch:")).toBe("no-branch:");
  });

  it("空/未指定は空文字", () => {
    expect(baseWorkspaceName("")).toBe("");
    expect(baseWorkspaceName(undefined)).toBe("");
    expect(baseWorkspaceName(null)).toBe("");
  });
});

describe("worktreeWorkspaceName", () => {
  it("ベース名とブランチ名から\"base:branch\"形式を組み立てる（baseWorkspaceNameの逆）", () => {
    expect(worktreeWorkspaceName("dw-joy-frontend", "feature/DW_JOY_DEV-975")).toBe("dw-joy-frontend:feature/DW_JOY_DEV-975");
    expect(baseWorkspaceName(worktreeWorkspaceName("app", "feat/x"))).toBe("app");
  });

  it("baseかbranchが無ければ空文字", () => {
    expect(worktreeWorkspaceName("", "feat/x")).toBe("");
    expect(worktreeWorkspaceName("app", "")).toBe("");
    expect(worktreeWorkspaceName(undefined, undefined)).toBe("");
  });
});
