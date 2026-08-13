// @ts-check
/**
 * セッションサイドバー（ui/utils/session-sidebar.js）の表示行組み立ての検証。
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_STATE_META,
  agentStateDescriptor,
  resolveAgentBadgeState,
  sessionSidebarItems,
  pendingDispatchSidebarItems,
} from "../../ui/utils/session-sidebar.ts";

describe("agentStateDescriptor", () => {
  it("既知の状態はアイコン・ラベル・クラス名を返す", () => {
    for (const state of ["working", "blocked", "done"]) {
      const meta = agentStateDescriptor(state);
      expect(meta).toBe(AGENT_STATE_META[state]);
      expect(meta?.icon).toMatch(/^mdi-/);
      expect(meta?.label.length).toBeGreaterThan(0);
      expect(meta?.className).toMatch(/^agent-state-/);
    }
  });

  it("未知・未設定の状態は null を返す", () => {
    expect(agentStateDescriptor("unknown")).toBeNull();
    expect(agentStateDescriptor("")).toBeNull();
    expect(agentStateDescriptor(undefined)).toBeNull();
  });

  it("idleはAGENT_STATE_METAに定義が無い（バッジを出さない）", () => {
    expect(AGENT_STATE_META.idle).toBeUndefined();
    expect(agentStateDescriptor("idle")).toBeNull();
  });
});

describe("resolveAgentBadgeState", () => {
  it("doneSessionsに含まれていればidleでも常にdoneを返す", () => {
    expect(resolveAgentBadgeState("idle", true)).toBe("done");
    expect(resolveAgentBadgeState(undefined, true)).toBe("done");
  });

  it("doneでなければidleはnullに潰す", () => {
    expect(resolveAgentBadgeState("idle", false)).toBeNull();
    expect(resolveAgentBadgeState(undefined, false)).toBeNull();
  });

  it("working/blockedはdoneでなければそのまま通す", () => {
    expect(resolveAgentBadgeState("working", false)).toBe("working");
    expect(resolveAgentBadgeState("blocked", false)).toBe("blocked");
  });
});

describe("sessionSidebarItems", () => {
  const tabs = [
    { id: 1, sessionId: "s1", workspace: "app", label: "app", wsIcon: { name: "mdi-web", color: "#fff" }, icon: null },
    { id: 2, sessionId: "s2", workspace: null, label: "bare", wsIcon: null, icon: { name: "mdi-robot", color: null } },
    { id: 3, sessionId: "s3", workspace: "wt", label: "wt", wsIcon: null, icon: null },
  ];
  const workspaces = [
    { name: "app", branch: "main", clean: false, ahead: 2, behind: 1, changed_files: 3, insertions: 10, deletions: 4 },
    { name: "wt", branch: "feat/x", worktree: true, worktree_base: "app", worktree_branch: "feat/x", clean: true },
  ];

  it("ワークスペースのブランチ・変更サマリ・ahead/behind を行に反映する", () => {
    const items = sessionSidebarItems(tabs, workspaces);
    expect(items).toHaveLength(3);
    const app = items[0];
    expect(app.id).toBe(1);
    expect(app.label).toBe("app");
    expect(app.branch).toBe("main");
    expect(app.dirty).toBe(true);
    expect(app.ahead).toBe(2);
    expect(app.behind).toBe(1);
    expect(app.changedFiles).toBe(3);
    expect(app.insertions).toBe(10);
    expect(app.deletions).toBe(4);
    expect(app.icon).toEqual({ name: "mdi-web", color: "#fff" });
    expect(app.tab).toBe(tabs[0]);
  });

  it("wsIconとjobIconはTabItemと同じく別枠で両方返す", () => {
    const tabsWithBoth = [
      { id: 4, sessionId: "s4", workspace: "app", label: "app", wsIcon: { name: "mdi-web", color: "#fff" }, icon: { name: "mdi-play", color: "#0f0" } },
    ];
    const items = sessionSidebarItems(tabsWithBoth, workspaces);
    expect(items[0].wsIcon).toEqual({ name: "mdi-web", color: "#fff" });
    expect(items[0].jobIcon).toEqual({ name: "mdi-play", color: "#0f0" });
  });

  it("ベアターミナルはラベルへフォールバックし git 情報は空になる", () => {
    const items = sessionSidebarItems(tabs, workspaces);
    const bare = items[1];
    expect(bare.label).toBe("bare");
    expect(bare.branch).toBe("");
    expect(bare.dirty).toBe(false);
    expect(bare.ahead).toBe(0);
    expect(bare.icon).toEqual({ name: "mdi-robot", color: null });
  });

  it("worktree は「ベース名 | ブランチ」表示になり isWorktree が立つ", () => {
    const items = sessionSidebarItems(tabs, workspaces);
    const wt = items[2];
    expect(wt.label).toBe("app | feat/x");
    expect(wt.isWorktree).toBe(true);
    expect(wt.dirty).toBe(false);
  });

  it("label 未設定のベアターミナルは terminal になる", () => {
    const items = sessionSidebarItems([{ id: 9, sessionId: "s9", workspace: null, label: "" }], []);
    expect(items[0].label).toBe("terminal");
  });

  it("autoDiscovered なタブは除外する（TabBar と同じ条件）", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      tabFlags: { 2: { autoDiscovered: true } },
    });
    expect(items.map((i) => i.id)).toEqual([1, 3]);
  });

  it("エージェント状態と phrase 通知を sessionId で紐付ける", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      agentStates: { s1: "working", s2: "blocked", s3: "unknown" },
      phraseNotifySessions: { s2: true },
    });
    expect(items[0].agent).toBe(AGENT_STATE_META.working);
    expect(items[1].agent).toBe(AGENT_STATE_META.blocked);
    expect(items[2].agent).toBeNull();
    expect(items[0].phraseNotify).toBe(false);
    expect(items[1].phraseNotify).toBe(true);
  });

  it("idleはバッジ非表示、doneSessionsに含まれていればdoneを表示する", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      agentStates: { s1: "idle", s2: "idle" },
      doneSessions: { s2: true },
    });
    expect(items[0].agent).toBeNull();
    expect(items[1].agent).toBe(AGENT_STATE_META.done);
  });

  it("タブが空・未定義でも空配列を返す", () => {
    expect(sessionSidebarItems([], [])).toEqual([]);
    expect(sessionSidebarItems(undefined, undefined)).toEqual([]);
  });
});

describe("sessionSidebarItems: Info Pills用データ（PR/Actions/Dev Server/Dispatch）", () => {
  const tabs = [
    { id: 1, sessionId: "s1", workspace: "app", label: "app", wsIcon: null, icon: null },
    { id: 2, sessionId: "s2", workspace: "nogit", label: "nogit", wsIcon: null, icon: null },
  ];
  const workspaces = [
    { name: "app", branch: "main", is_git_repo: true, clean: true, ahead: 0, behind: 0 },
    { name: "nogit", branch: "", is_git_repo: false },
  ];

  it("isGitRepoでない・workspace未紐付けはPR/Actions/Dev Serverの対象外", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      prsByWorkspace: { nogit: [{ headRefName: "main" }] },
      runsByWorkspace: { nogit: [{ headBranch: "main", status: "in_progress" }] },
    });
    const nogit = items.find((i) => i.id === 2);
    expect(nogit.isGitRepo).toBe(false);
    expect(nogit.hasPr).toBe(false);
    expect(nogit.hasAction).toBe(false);
  });

  it("現在のブランチに対応するPR/実行中ActionsがあればhasPr/hasActionが立つ", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      prsByWorkspace: { app: [{ headRefName: "main", number: 1, title: "fix" }] },
      runsByWorkspace: { app: [{ headBranch: "main", status: "in_progress" }] },
    });
    const app = items.find((i) => i.id === 1);
    expect(app.hasPr).toBe(true);
    expect(app.hasAction).toBe(true);
    expect(app.tooltips.prs).toContain("#1");
  });

  it("成功で完了したrunはhasActionを立てない（isNoticeableRunと同じ判定）", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      runsByWorkspace: { app: [{ headBranch: "main", status: "completed", conclusion: "success" }] },
    });
    expect(items.find((i) => i.id === 1).hasAction).toBe(false);
  });

  it("該当workspaceのproxy_port検出でhasDevServerが立つ", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      previewPorts: [{ workspace: "app", proxy_port: 3000 }, { workspace: "nogit", proxy_port: null }],
    });
    expect(items.find((i) => i.id === 1).hasDevServer).toBe(true);
    expect(items.find((i) => i.id === 2).hasDevServer).toBe(false);
  });

  it("dispatchQueueをworkspaceで絞り込みdispatchCountに反映する", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      dispatchQueue: [{ request: { workspace: "app" } }, { request: { workspace: "other" } }],
    });
    expect(items.find((i) => i.id === 1).dispatchCount).toBe(1);
    expect(items.find((i) => i.id === 2).dispatchCount).toBe(0);
  });

  it("tooltipsにbranch/changes/devserverの文言を組み立てる", () => {
    const items = sessionSidebarItems(tabs, workspaces, {
      previewPorts: [{ workspace: "app", proxy_port: 3000, scheme: "http" }],
    });
    const app = items.find((i) => i.id === 1);
    expect(app.tooltips.branch).toContain("main");
    expect(app.tooltips.devserver).toContain("Dev Server");
  });
});

describe("pendingDispatchSidebarItems", () => {
  const workspaces = [
    { name: "app", branch: "main", is_git_repo: true, clean: false, ahead: 1, changed_files: 2 },
    { name: "wt", branch: "feat/x", worktree: true, worktree_base: "app", worktree_branch: "feat/x" },
  ];

  it("タブが開いていないワークスペースだけをワークスペース単位でまとめる", () => {
    const items = pendingDispatchSidebarItems(workspaces, new Set(["already-open"]), {
      dispatchQueue: [
        { request: { workspace: "app" } },
        { request: { workspace: "app" } },
        { request: { workspace: "already-open" } },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].workspace).toBe("app");
    expect(items[0].dispatchCount).toBe(2);
  });

  it("sessionSidebarItemsと同じくgit/PR/Actions/DevServerの各ピル用フィールドを持つ", () => {
    const items = pendingDispatchSidebarItems(workspaces, new Set(), {
      dispatchQueue: [{ request: { workspace: "app" } }],
      prsByWorkspace: { app: [{ headRefName: "main", number: 1, title: "fix" }] },
      previewPorts: [{ workspace: "app", proxy_port: 3000 }],
    });
    const app = items.find((i) => i.workspace === "app");
    expect(app.isGitRepo).toBe(true);
    expect(app.branch).toBe("main");
    expect(app.dirty).toBe(true);
    expect(app.ahead).toBe(1);
    expect(app.hasPr).toBe(true);
    expect(app.hasDevServer).toBe(true);
    expect(app.agent).toEqual({ icon: "mdi-inbox-arrow-down-outline", label: "Pending", className: "agent-state-dispatch-pending" });
  });

  it("worktreeは「ベース名 | ブランチ」表示になる", () => {
    const items = pendingDispatchSidebarItems(workspaces, new Set(), {
      dispatchQueue: [{ request: { workspace: "wt" } }],
    });
    expect(items[0].label).toBe("app | feat/x");
    expect(items[0].isWorktree).toBe(true);
  });

  it("該当ワークスペースが未登録でもワークスペース名をラベルに使う", () => {
    const items = pendingDispatchSidebarItems([], new Set(), {
      dispatchQueue: [{ request: { workspace: "unknown-ws" } }],
    });
    expect(items[0].label).toBe("unknown-ws");
    expect(items[0].wsIcon).toBeNull();
  });
});
