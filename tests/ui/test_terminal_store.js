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

describe("terminal store: setTabWorkspace", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTerminalStore();
  });

  it("workspace を更新し、tab オブジェクト自体を新しい参照に差し替える", () => {
    seedTabs(store, [{ id: 1 }, { id: 2 }]);
    const before = store.openTabs.find((t) => t.id === 1);
    store.setTabWorkspace(1, "ws1");
    const after = store.openTabs.find((t) => t.id === 1);
    expect(after.workspace).toBe("ws1");
    expect(after).not.toBe(before);
  });

  it("対象外のタブオブジェクトは参照を維持する", () => {
    seedTabs(store, [{ id: 1 }, { id: 2 }]);
    const other = store.openTabs.find((t) => t.id === 2);
    store.setTabWorkspace(1, "ws1");
    expect(store.openTabs.find((t) => t.id === 2)).toBe(other);
  });

  it("存在しない tabId は何もしない", () => {
    seedTabs(store, [{ id: 1 }]);
    const before = store.openTabs;
    store.setTabWorkspace(999, "ws1");
    expect(store.openTabs).toBe(before);
  });
});

describe("terminal store: addTerminalTab の重複防止", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTerminalStore();
  });

  it("同一 session_id で2回呼んでも既存タブを返しタブは増えない", () => {
    // dispatch のセッション作成通知(WS)とポーリング同期が競合しても、
    // 二重タブが生成されないことの回帰テスト。
    const tab1 = store.addTerminalTab({ wsUrl: "/terminal/ws/sess1", workspace: "ws1" });
    const tab2 = store.addTerminalTab({ wsUrl: "/terminal/ws/sess1", workspace: "ws1" });
    expect(tab2).toBe(tab1);
    expect(store.openTabs.length).toBe(1);
  });

  it("session_id が異なれば別タブとして追加される", () => {
    store.addTerminalTab({ wsUrl: "/terminal/ws/sess1", workspace: "ws1" });
    store.addTerminalTab({ wsUrl: "/terminal/ws/sess2", workspace: "ws1" });
    expect(store.openTabs.length).toBe(2);
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
