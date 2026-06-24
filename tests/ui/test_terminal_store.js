// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalStore } from "../../ui/stores/terminal.js";

// addTerminalTab は xterm 依存で重いので使わず、active 再選出ロジックの検証に
// 必要な最小プロパティ（id / hidden / term / sessionId）だけのタブを直接挿入する。
// term:null → removeTab の dispose をスキップ、sessionId:"" → setTabHidden の
// backend 反映 fetch をスキップ。
function seedTabs(store, specs) {
  store.openTabs = specs.map((s) => ({
    id: s.id,
    sessionId: "",
    hidden: !!s.hidden,
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

  describe("setTabHidden", () => {
    it("アクティブタブを hidden にすると次の visible タブへ active が移る", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 1;
      store.setTabHidden(1, true);
      expect(store.activeTabId).toBe(2);
    });

    it("後続に visible が無ければ手前の visible タブが選ばれる", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 3;
      store.setTabHidden(3, true);
      expect(store.activeTabId).toBe(2);
    });

    it("非アクティブタブを hidden にしても active は変わらない", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }]);
      store.activeTabId = 1;
      store.setTabHidden(2, true);
      expect(store.activeTabId).toBe(1);
    });

    it("全タブが hidden になったら active は null", () => {
      seedTabs(store, [{ id: 1 }]);
      store.activeTabId = 1;
      store.setTabHidden(1, true);
      expect(store.activeTabId).toBe(null);
    });

    it("hidden を解除する操作では active を動かさない", () => {
      seedTabs(store, [{ id: 1, hidden: true }, { id: 2 }]);
      store.activeTabId = 2;
      store.setTabHidden(1, false);
      expect(store.activeTabId).toBe(2);
    });
  });

  describe("removeTab", () => {
    it("アクティブタブ削除で次の visible タブへ active が移る", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      store.activeTabId = 1;
      store.removeTab(1);
      expect(store.activeTabId).toBe(2);
    });

    it("active 再選出は hidden タブをスキップする", () => {
      seedTabs(store, [{ id: 1 }, { id: 2, hidden: true }, { id: 3 }]);
      store.activeTabId = 1;
      store.removeTab(1);
      expect(store.activeTabId).toBe(3);
    });

    it("非アクティブタブ削除では active は変わらない", () => {
      seedTabs(store, [{ id: 1 }, { id: 2 }]);
      store.activeTabId = 2;
      store.removeTab(1);
      expect(store.activeTabId).toBe(2);
    });
  });
});
