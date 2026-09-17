// @ts-check
import { describe, it, expect } from "vitest";
import { buildPeekFields, buildPillFields } from "../../ui/utils/pill-fields.ts";
import { buildTrailingPeekItems } from "../../ui/utils/pill-peek.ts";

const gitWs = {
  name: "app", is_git_repo: true, branch: "main", clean: false,
  ahead: 1, behind: 2, changed_files: 3, insertions: 4, deletions: 5,
  last_commit_message: "init", has_upstream: true,
};

const ALL_PILLS_ON = {
  branch: true, prs: true, actions: true, changes: true, devserver: true,
  docker: true, issues: true, files: true, add: true, dispatch: true,
};

describe("buildPillFields", () => {
  it("gitリポジトリでないワークスペースは、Issuesが取得済みでも件数0（TerminalPaneと同じ判定）", () => {
    const pill = buildPillFields("plain", { name: "plain", is_git_repo: false }, {
      issuesByWorkspace: { plain: [{ number: 1 }] },
    });
    expect(pill.issuesCount).toBe(0);
  });

  it("ワークスペース未紐付けではDev Server/Docker/Dispatchを他のターミナルの検出結果と取り違えない", () => {
    const pill = buildPillFields(null, undefined, {
      previewPorts: [{ workspace: null, proxy_port: 3000 }],
      dockerContainers: [{ workspace: null, state: "running" }],
      dispatchQueue: [{ request: { workspace: "" } }],
    });
    expect(pill.devServerEntry).toBeNull();
    expect(pill.dockerContainers).toEqual([]);
    expect(pill.dispatchItems).toEqual([]);
    expect(pill.wsResolved).toBe(false);
  });

  it("tooltipNameを省略するとワークスペース名、指定するとその名前をツールチップに使う", () => {
    const byWs = buildPillFields("app", gitWs, {});
    const byLabel = buildPillFields(null, undefined, {}, "my-terminal");
    expect(JSON.stringify(byWs.tooltips)).toContain("app");
    expect(JSON.stringify(byLabel.tooltips)).toContain("my-terminal");
  });
});

describe("buildPeekFields", () => {
  it("DockerとIssuesもpeekの変化検出対象に含める（サイドバーで検出漏れしていた回帰の防止）", () => {
    const pill = buildPillFields("app", gitWs, {
      dockerContainers: [{ workspace: "app", state: "running", name: "web-1" }],
      issuesByWorkspace: { app: [{ number: 1 }, { number: 2 }] },
    });
    const fields = buildPeekFields({ workspace: "app", label: "app", sessionId: "s1" }, pill);
    const keys = buildTrailingPeekItems(fields, ALL_PILLS_ON).map((i) => i.key);
    expect(keys).toContain("docker");
    expect(keys).toContain("issues");
  });

  it("タブ情報とピル値から、ラベル・セッション有無・git値を組み立てる", () => {
    const pill = buildPillFields("app", gitWs, {});
    expect(buildPeekFields({ workspace: "app", label: "x", sessionId: "s1" }, pill)).toMatchObject({
      workspaceLabel: "app", hasSession: true, hasWorkspace: true, isGitRepo: true, isDirty: true,
      changedFiles: 3, insertions: 4, deletions: 5, branch: "main", ahead: 1, behind: 2, lastCommitMessage: "init",
    });
    expect(buildPeekFields({ workspace: null, label: "term", sessionId: null }, buildPillFields(null, undefined, {})))
      .toMatchObject({ workspaceLabel: "term", hasSession: false, hasWorkspace: false });
  });
});
