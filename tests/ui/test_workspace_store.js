// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.js";

describe("workspace store: applyStatuses", () => {
  let store;
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    store = useWorkspaceStore();
    store.allWorkspaces = [
      { name: "ws1", path: "/repos/ws1", is_git_repo: true },
      { name: "ws2", path: "/repos/ws2", is_git_repo: true },
    ];
  });

  it("該当ワークスペースへステータスをマージする", () => {
    store.applyStatuses([
      { name: "ws1", clean: false, ahead: 2, behind: 1, branch: "main" },
    ]);
    const ws1 = store.allWorkspaces.find((w) => w.name === "ws1");
    expect(ws1.clean).toBe(false);
    expect(ws1.ahead).toBe(2);
    expect(ws1.behind).toBe(1);
    // 対象外のワークスペースは変わらない
    const ws2 = store.allWorkspaces.find((w) => w.name === "ws2");
    expect(ws2.clean).toBeUndefined();
  });

  it("null 値では既存値を上書きしない", () => {
    store.applyStatuses([{ name: "ws1", branch: "main", last_commit_message: "feat: x" }]);
    store.applyStatuses([{ name: "ws1", branch: "feature", last_commit_message: null }]);
    const ws1 = store.allWorkspaces.find((w) => w.name === "ws1");
    expect(ws1.branch).toBe("feature");
    expect(ws1.last_commit_message).toBe("feat: x");
  });

  it("未知のワークスペース名は無視する", () => {
    expect(() => store.applyStatuses([{ name: "nope", clean: false }])).not.toThrow();
  });

  it("配列以外・空配列は何もしない", () => {
    expect(() => store.applyStatuses(null)).not.toThrow();
    expect(() => store.applyStatuses([])).not.toThrow();
  });

  it("キャッシュ対象フィールドを localStorage へ保存する", () => {
    store.applyStatuses([{ name: "ws1", branch: "main", last_commit_message: "feat: x" }]);
    const cached = JSON.parse(localStorage.getItem("ws_meta_status_cache"));
    expect(cached.ws1).toEqual({ branch: "main", last_commit_message: "feat: x" });
  });
});
