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

  it("labelを省略するとホスト名をlabelにする（フルURLは長すぎるため表示しない）", () => {
    store.openBrowserTab("http://localhost:3000/foo?x=1");
    expect(store.tabs[0].label).toBe("localhost");
  });

  it("labelを指定できる", () => {
    store.openBrowserTab("http://localhost:3000/", { label: "My App" });
    expect(store.tabs[0].label).toBe("My App");
  });

  it("icon/iconColorを指定できる", () => {
    store.openBrowserTab("http://localhost:3000/", { icon: "mdi-rocket", iconColor: "#ff0000" });
    expect(store.tabs[0].icon).toBe("mdi-rocket");
    expect(store.tabs[0].iconColor).toBe("#ff0000");
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

    expect(store.tabs).toEqual([{ id: id1, url: "http://localhost:3000/", label: "localhost" }]);
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

  it("labelがホスト名フォールバックのままなら新URLのホスト名に追従する", () => {
    const id = store.openBrowserTab("http://localhost:3000/");
    store.updateBrowserTabUrl(id, "http://example.com/");
    expect(store.tabs[0].label).toBe("example.com");
  });

  it("明示的なlabelは書き換えない", () => {
    const id = store.openBrowserTab("http://localhost:3000/", { label: "My App" });
    store.updateBrowserTabUrl(id, "http://example.com/");
    expect(store.tabs[0].label).toBe("My App");
  });

  it("存在しないIDは無視する", () => {
    store.openBrowserTab("http://localhost:3000/");
    store.updateBrowserTabUrl(9999, "http://example.com/");
    expect(store.tabs[0].url).toBe("http://localhost:3000/");
  });
});

describe("browserTabs store: reloadBrowserTab", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("登録済みハンドラを呼び出す", () => {
    const handler = vi.fn();
    store.registerReloadHandler(1, handler);
    store.reloadBrowserTab(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("未登録のIDは何もしない", () => {
    expect(() => store.reloadBrowserTab(9999)).not.toThrow();
  });

  it("unregisterReloadHandler後は呼び出されない", () => {
    const handler = vi.fn();
    store.registerReloadHandler(1, handler);
    store.unregisterReloadHandler(1);
    store.reloadBrowserTab(1);
    expect(handler).not.toHaveBeenCalled();
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

  it("サーバーから受け取ったタブ一覧を反映し、isRestoredをtrueにする", () => {
    expect(store.isRestored).toBe(false);
    store.restoreFromServer(
      [{ url: "http://localhost:3000/", label: "App", icon: "mdi-rocket", iconColor: "#ff0000" }],
      null,
    );
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]).toMatchObject({ url: "http://localhost:3000/", label: "App", icon: "mdi-rocket", iconColor: "#ff0000" });
    expect(store.isRestored).toBe(true);
  });

  it("activeUrlに一致するタブをアクティブにする（idは復元のたびに振り直されるためURLで突き合わせる）", () => {
    store.restoreFromServer(
      [{ url: "http://localhost:3000/", label: "a" }, { url: "http://localhost:4000/", label: "b" }],
      "http://localhost:3000/",
    );
    const activeTab = store.tabs.find((t) => t.id === store.activeBrowserTabId);
    expect(activeTab?.url).toBe("http://localhost:3000/");
  });

  it("activeUrlがtabs内に無ければactiveBrowserTabIdはnull", () => {
    store.restoreFromServer([{ url: "http://localhost:3000/", label: "a" }], "http://localhost:9999/");
    expect(store.activeBrowserTabId).toBeNull();
  });

  it("空配列を渡せばタブ無し・非アクティブになる", () => {
    store.openBrowserTab("http://localhost:3000/");
    store.restoreFromServer([], null);
    expect(store.tabs).toEqual([]);
    expect(store.activeBrowserTabId).toBeNull();
  });
});
