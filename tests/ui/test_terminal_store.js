// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalStore } from "../../ui/stores/terminal.js";

// addTerminalTab は xterm 依存で重いので使わず、active 再選出ロジックの検証に
// 必要な最小プロパティ（id / term / sessionId）だけのタブを直接挿入する。
// term:null → removeTab / detachTab の dispose をスキップ、sessionId:"" → API fetch をスキップ。
function seedTabs(store, specs) {
  store.openTabs = specs.map((s) => ({
    id: s.id,
    sessionId: "",
    term: null,
    ws: null,
  }));
}

describe("terminal store: active 再選出", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTerminalStore();
  });

  describe("detachTab", () => {
    it("アクティブタブを detach すると次のタブへ active が移る", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 1;
      store.detachTab(1);
      expect(store.activeTabId).toBe(2);
    });

    it("後続タブが無ければ手前のタブが選ばれる", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 3;
      store.detachTab(3);
      expect(store.activeTabId).toBe(2);
    });

    it("非アクティブタブを detach しても active は変わらない", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }]);
      store.activeTabId = 1;
      store.detachTab(2);
      expect(store.activeTabId).toBe(1);
    });

    it("最後のタブを detach したら active は null", () => {
      seedTabs(store, [{ id: 1 }]);
      store.activeTabId = 1;
      store.detachTab(1);
      expect(store.activeTabId).toBe(null);
    });

    it("detach したタブは openTabs から消える", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }]);
      store.detachTab(1);
      expect(store.openTabs.map((t) => t.id)).toEqual([2]);
    });
  });

  describe("removeTab", () => {
    it("アクティブタブ削除で次のタブへ active が移る", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 1;
      store.removeTab(1);
      expect(store.activeTabId).toBe(2);
    });

    it("後続タブが無ければ手前のタブが選ばれる", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 3;
      store.removeTab(3);
      expect(store.activeTabId).toBe(2);
    });

    it("非アクティブタブ削除では active は変わらない", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }]);
      store.activeTabId = 2;
      store.removeTab(1);
      expect(store.activeTabId).toBe(2);
    });
  });
});

describe("terminal store: agentStates", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTerminalStore();
  });

  it("applyAgentStates で sessionId ごとの状態をマージする", () => {
    store.applyAgentStates([
      { session_id: "s1", state: "idle" },
      { session_id: "s2", state: "working" },
    ]);
    expect(store.agentStates.s1).toBe("idle");
    expect(store.agentStates.s2).toBe("working");

    store.applyAgentStates([{ session_id: "s1", state: "working" }]);
    expect(store.agentStates.s1).toBe("working");
    expect(store.agentStates.s2).toBe("working");
  });

  it("不正なエントリと配列以外は無視する", () => {
    store.applyAgentStates([
      null,
      { session_id: 1, state: "working" },
      { session_id: "s3" },
    ]);
    expect(Object.keys(store.agentStates)).toEqual([]);
    store.applyAgentStates("not-an-array");
    expect(Object.keys(store.agentStates)).toEqual([]);
  });
});
