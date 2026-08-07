// @ts-check
/**
 * セッションサイドバー（ui/utils/session-sidebar.js）の表示行組み立ての検証。
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_STATE_META,
  agentStateDescriptor,
  sessionSidebarItems,
} from "../../ui/utils/session-sidebar.js";

describe("agentStateDescriptor", () => {
  it("既知の状態はアイコン・ラベル・クラス名を返す", () => {
    for (const state of ["working", "blocked", "done", "idle"]) {
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

  it("タブが空・未定義でも空配列を返す", () => {
    expect(sessionSidebarItems([], [])).toEqual([]);
    expect(sessionSidebarItems(undefined, undefined)).toEqual([]);
  });
});
