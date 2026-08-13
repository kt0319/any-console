// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalStore } from "../../ui/stores/terminal.js";
import { WORKING_MIN_DURATION_MS } from "../../ui/utils/constants.ts";

// addTerminalTab は xterm 依存で重いので使わず、active 再選出ロジックの検証に
// 必要な最小プロパティ（id / term / sessionId）だけのタブを直接挿入する。
// term:null → removeTab / detachTab の dispose をスキップ、sessionId:"" → API fetch をスキップ。
function seedTabs(store, specs) {
  store.openTabs = specs.map((s) => ({
    sessionId: "",
    term: null,
    ws: null,
    ...s,
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

    it("アクティブタブを detach して次のタブへ active が移ると、そのタブの doneSessions がクリアされる", () => {
      seedTabs(store, [{ id: 1, sessionId: "s1" }, { id: 2, sessionId: "s2" }]);
      store.doneSessions.s2 = true;
      store.activeTabId = 1;
      store.detachTab(1);
      expect(store.activeTabId).toBe(2);
      expect(store.doneSessions.s2).toBeUndefined();
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

  it("workspace を更新するが、tab オブジェクト自体の参照は維持する", () => {
    // tab は markRaw で connectTerminalWs/bindTerminalInput 等がこの identity を
    // クロージャで握っているため、差し替えるとソケット/入力バインドの実行時
    // 状態が新旧オブジェクトに分裂して壊れる。identity は変えず、フィールドの
    // 変更だけを行う（変更の伝播は tabWorkspaceVersion が担う。下記テスト参照）。
    seedTabs(store, [{ id: 1 }, { id: 2 }]);
    const before = store.openTabs.find((t) => t.id === 1);
    store.setTabWorkspace(1, "ws1");
    const after = store.openTabs.find((t) => t.id === 1);
    expect(after.workspace).toBe("ws1");
    expect(after).toBe(before);
  });

  it("tabWorkspaceVersion を進め、tab は markRaw でも変更を検知できるようにする", () => {
    seedTabs(store, [{ id: 1 }]);
    const before = store.tabWorkspaceVersion;
    store.setTabWorkspace(1, "ws1");
    expect(store.tabWorkspaceVersion).toBe(before + 1);
  });

  it("存在しない tabId は何もしない", () => {
    seedTabs(store, [{ id: 1 }]);
    const beforeVersion = store.tabWorkspaceVersion;
    store.setTabWorkspace(999, "ws1");
    expect(store.tabWorkspaceVersion).toBe(beforeVersion);
    expect(store.openTabs.find((t) => t.id === 1).workspace).toBeUndefined();
  });

  it("iconInfoを渡すとtab.wsIconも更新する（タブアイコン即時反映）", () => {
    seedTabs(store, [{ id: 1, wsIcon: null }]);
    store.setTabWorkspace(1, "ws1", { icon: "mdi-folder", iconColor: "#f00" });
    const tab = store.openTabs.find((t) => t.id === 1);
    expect(tab.wsIcon).toEqual({ name: "mdi-folder", color: "#f00" });
  });

  it("iconInfoを渡さない場合はtab.wsIconを変更しない", () => {
    seedTabs(store, [{ id: 1, wsIcon: { name: "mdi-old", color: null } }]);
    store.setTabWorkspace(1, "ws1");
    const tab = store.openTabs.find((t) => t.id === 1);
    expect(tab.wsIcon).toEqual({ name: "mdi-old", color: null });
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

  it("working が WORKING_MIN_DURATION_MS 以上続いてから idle に遷移すると doneSessions が立つ", () => {
    vi.useFakeTimers();
    try {
      store.applyAgentStates([{ session_id: "s1", state: "working" }]);
      vi.advanceTimersByTime(WORKING_MIN_DURATION_MS);
      store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
      expect(store.doneSessions.s1).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("working が WORKING_MIN_DURATION_MS 未満で idle に戻ると doneSessions は立たない（一瞬のworking誤検出対策）", () => {
    vi.useFakeTimers();
    try {
      store.applyAgentStates([{ session_id: "s1", state: "working" }]);
      vi.advanceTimersByTime(WORKING_MIN_DURATION_MS - 1000);
      store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
      expect(store.doneSessions.s1).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("working継続中に届く重複working通知はworking開始時刻をリセットしない", () => {
    vi.useFakeTimers();
    try {
      store.applyAgentStates([{ session_id: "s1", state: "working" }]);
      vi.advanceTimersByTime(3000);
      store.applyAgentStates([{ session_id: "s1", state: "working" }]);
      vi.advanceTimersByTime(3000);
      store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
      expect(store.doneSessions.s1).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("working を経由しない idle は doneSessions を立てない", () => {
    store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
    expect(store.doneSessions.s1).toBeUndefined();
  });

  it("done中にworking/blockedが届くとdoneSessionsはクリアされる", () => {
    vi.useFakeTimers();
    try {
      store.applyAgentStates([{ session_id: "s1", state: "working" }]);
      vi.advanceTimersByTime(WORKING_MIN_DURATION_MS);
      store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
      expect(store.doneSessions.s1).toBe(true);
      store.applyAgentStates([{ session_id: "s1", state: "blocked" }]);
      expect(store.doneSessions.s1).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switchTab でタブを見ると doneSessions がクリアされる", () => {
    seedTabs(store, [{ id: 1, sessionId: "s1" }]);
    vi.useFakeTimers();
    store.applyAgentStates([{ session_id: "s1", state: "working" }]);
    vi.advanceTimersByTime(WORKING_MIN_DURATION_MS);
    store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
    vi.useRealTimers();
    expect(store.doneSessions.s1).toBe(true);
    store.switchTab(1);
    expect(store.doneSessions.s1).toBeUndefined();
  });

  it("clearAgentState で agentStates と doneSessions を両方消す", () => {
    vi.useFakeTimers();
    store.applyAgentStates([{ session_id: "s1", state: "working" }]);
    vi.advanceTimersByTime(WORKING_MIN_DURATION_MS);
    store.applyAgentStates([{ session_id: "s1", state: "idle" }]);
    vi.useRealTimers();
    store.clearAgentState("s1");
    expect(store.agentStates.s1).toBeUndefined();
    expect(store.doneSessions.s1).toBeUndefined();
  });
});
