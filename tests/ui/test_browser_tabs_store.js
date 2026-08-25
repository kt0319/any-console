// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useBrowserTabStore } from "../../ui/stores/browserTabs.ts";

describe("browserTabs store: openBrowserTab", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("新規URLはタブを追加してアクティブにする", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    expect(store.tabs.length).toBe(1);
    expect(store.tabs[0].url).toBe("http://localhost:3000/");
    expect(store.activeBrowserTabId).toBe(id);
  });

  it("labelはホスト名(ポート番号込み)にする（フルURLは長すぎるため表示しない）", () => {
    store.openBrowserTab("http://localhost:3000/foo?x=1");
    expect(store.tabs[0].label).toBe("localhost:3000");
  });

  it("同じURLを2回開いても重複せず既存タブをアクティブにする", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    store.openBrowserTab("http://localhost:4000/");
    const id1Again = store.openBrowserTab("http://localhost:3000/");

    expect(store.tabs.length).toBe(2);
    expect(id1Again).toBe(id1);
    expect(store.activeBrowserTabId).toBe(id1);
  });
});

describe("browserTabs store: selectBrowserTab", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("存在するタブへ切り替える", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    const id2 = store.openBrowserTab("http://localhost:4000/");
    store.selectBrowserTab(id1);
    expect(store.activeBrowserTabId).toBe(id1);
    store.selectBrowserTab(id2);
    expect(store.activeBrowserTabId).toBe(id2);
  });

  it("存在しないIDは無視する", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    store.selectBrowserTab(9999);
    expect(store.activeBrowserTabId).toBe(id1);
  });
});

describe("browserTabs store: closeBrowserTab", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("アクティブでないタブを閉じてもアクティブタブは変わらない", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    const id2 = store.openBrowserTab("http://localhost:4000/");
    store.selectBrowserTab(id1);

    store.closeBrowserTab(id2);

    expect(store.tabs.length).toBe(1);
    expect(store.activeBrowserTabId).toBe(id1);
  });

  it("アクティブなタブを閉じると他のブラウザタブへフォールバックする", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    const id2 = store.openBrowserTab("http://localhost:4000/");
    store.selectBrowserTab(id2);

    store.closeBrowserTab(id2);

    expect(store.tabs).toEqual([{ id: id1, url: "http://localhost:3000/", label: "localhost:3000" }]);
    expect(store.activeBrowserTabId).toBe(id1);
  });

  it("最後の1件を閉じるとactiveBrowserTabIdがnullになる（ターミナル側へ戻る）", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");

    store.closeBrowserTab(id1);

    expect(store.tabs).toEqual([]);
    expect(store.activeBrowserTabId).toBeNull();
  });

  it("存在しないIDは無視する", () => {
    const id1 = store.openBrowserTab("http://localhost:3000/");
    store.closeBrowserTab(9999);
    expect(store.tabs.length).toBe(1);
    expect(store.activeBrowserTabId).toBe(id1);
  });
});

describe("browserTabs store: updateBrowserTabUrl", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("URLを書き換える", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    store.updateBrowserTabUrl(id, "http://localhost:4000/");
    expect(store.tabs[0].url).toBe("http://localhost:4000/");
  });

  it("labelは新URLのホスト名に追従する", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    store.updateBrowserTabUrl(id, "http://example.com/");
    expect(store.tabs[0].label).toBe("example.com");
  });

  it("存在しないIDは無視する", () => {
    store.openBrowserTab("http://localhost:3000/");
    store.updateBrowserTabUrl(9999, "http://example.com/");
    expect(store.tabs[0].url).toBe("http://localhost:3000/");
  });
});

describe("browserTabs store: showTerminal", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("前面のブラウザタブを退避してターミナル側へ戻す（タブ自体は残る）", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    expect(store.activeBrowserTabId).toBe(id);
    store.showTerminal();
    expect(store.activeBrowserTabId).toBe(null);
    expect(store.tabs.length).toBe(1);
  });

  it("ブラウザタブが前面でなくても安全に呼べる", () => {
    store.showTerminal();
    expect(store.activeBrowserTabId).toBe(null);
  });
});

describe("browserTabs store: setBrowserTabLoading", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("対象タブのloadingを更新する", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    store.setBrowserTabLoading(id, true);
    expect(store.tabs[0].loading).toBe(true);
    store.setBrowserTabLoading(id, false);
    expect(store.tabs[0].loading).toBe(false);
  });

  it("存在しないIDは無視する", () => {
    store.openBrowserTab("http://localhost:3000/");
    expect(() => store.setBrowserTabLoading(9999, true)).not.toThrow();
  });
});

describe("browserTabs store: restoreFromServer（useBrowserTabsPersist.restoreBrowserTabsから呼ばれる）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("サーバーから受け取ったタブ一覧を反映し、isRestoredをtrueにする。labelはURLから導出する（永続化された値は無い）", () => {
    expect(store.isRestored).toBe(false);
    store.restoreFromServer([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]).toMatchObject({ url: "http://localhost:3000/", label: "localhost:3000" });
    expect(store.isRestored).toBe(true);
  });

  it("activeUrlに一致するタブをアクティブにする（idは復元のたびに振り直されるためURLで突き合わせる）", () => {
    store.restoreFromServer(
      [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      "http://localhost:3000/",
    );
    const activeTab = store.tabs.find((t) => t.id === store.activeBrowserTabId);
    expect(activeTab?.url).toBe("http://localhost:3000/");
  });

  it("activeUrlがtabs内に無ければactiveBrowserTabIdはnull", () => {
    store.restoreFromServer([{ url: "http://localhost:3000/" }], "http://localhost:9999/");
    expect(store.activeBrowserTabId).toBeNull();
  });

  it("空配列を渡せばタブ無し・非アクティブになる", () => {
    store.openBrowserTab("http://localhost:3000/");
    store.restoreFromServer([], null);
    expect(store.tabs).toEqual([]);
    expect(store.activeBrowserTabId).toBeNull();
  });
});
