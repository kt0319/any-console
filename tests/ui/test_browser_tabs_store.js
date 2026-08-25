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

describe("browserTabs store: beginRestore / applyServerState（useBrowserTabsPersistから呼ばれる同期状態機械）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserTabStore();
  });

  it("サーバーから受け取ったタブ一覧を反映し、isRestoredをtrueにする。labelはURLから導出する（永続化された値は無い）", () => {
    expect(store.isRestored).toBe(false);
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]).toMatchObject({ url: "http://localhost:3000/", label: "localhost:3000" });
    expect(store.isRestored).toBe(true);
    expect(changed).toBe(false);
  });

  it("activeUrlに一致するタブをアクティブにする（idは復元のたびに振り直されるためURLで突き合わせる）", () => {
    store.applyServerState(
      [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      "http://localhost:3000/",
    );
    const activeTab = store.tabs.find((t) => t.id === store.activeBrowserTabId);
    expect(activeTab?.url).toBe("http://localhost:3000/");
  });

  it("activeUrlがtabs内に無ければactiveBrowserTabIdはnull", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], "http://localhost:9999/");
    expect(store.activeBrowserTabId).toBeNull();
  });

  it("未同期中に開いたタブはサーバー一覧の後ろへマージされて残り、changed=trueを返す", () => {
    store.openBrowserTab("http://localhost:5000/");
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/", "http://localhost:5000/"]);
    // 今見ているタブが結果にも残るのでアクティブ維持
    expect(store.tabs.find((t) => t.id === store.activeBrowserTabId)?.url).toBe("http://localhost:5000/");
    expect(changed).toBe(true);
  });

  it("synced後のbeginRestore→applyServerStateは操作記録が無いので置き換えになる（再マウントの残骸を復活させない）", () => {
    store.applyServerState(
      [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      "http://localhost:4000/",
    );
    // 再マウント相当: 他クライアントが4000を閉じた後に再復元
    store.beginRestore();
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], "http://localhost:3000/");
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    expect(store.tabs.find((t) => t.id === store.activeBrowserTabId)?.url).toBe("http://localhost:3000/");
    expect(changed).toBe(false);
  });

  it("未同期中に閉じたタブはサーバーに残っていても復活しない（changed=true）", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }], null);
    store.beginRestore();
    const target = store.tabs.find((t) => t.url === "http://localhost:4000/");
    store.closeBrowserTab(target.id);
    const changed = store.applyServerState(
      [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      null,
    );
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    expect(changed).toBe(true);
  });

  it("未同期中に閉じて開き直したタブは記録が相殺され、そのまま残る（changed=false）", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], null);
    store.beginRestore();
    const target = store.tabs.find((t) => t.url === "http://localhost:3000/");
    store.closeBrowserTab(target.id);
    store.openBrowserTab("http://localhost:3000/");
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    expect(changed).toBe(false);
  });

  it("未同期中のURL変更は「旧URLを閉じて新URLを開いた」として突き合わされる", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], null);
    store.beginRestore();
    const target = store.tabs.find((t) => t.url === "http://localhost:3000/");
    store.updateBrowserTabUrl(target.id, "http://localhost:4000/");
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:4000/"]);
    expect(changed).toBe(true);
  });

  it("未同期中に明示的にターミナルへ戻った場合、復元成功時にサーバーのactiveUrlで前面を奪わない", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], "http://localhost:3000/");
    store.beginRestore();
    store.showTerminal();
    store.applyServerState([{ url: "http://localhost:3000/" }], "http://localhost:3000/");
    expect(store.activeBrowserTabId).toBe(null);
    expect(store.tabs).toHaveLength(1);
  });

  it("未同期中に最後のタブを閉じてターミナルへ戻った場合も、復元成功時にサーバーのactiveUrlで前面を奪わない", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], "http://localhost:3000/");
    store.beginRestore();
    store.closeBrowserTab(store.tabs[0].id);
    expect(store.activeBrowserTabId).toBe(null);
    // 他クライアントが開いていた4000がサーバーのactiveUrlになっている
    store.applyServerState(
      [{ url: "http://localhost:3000/" }, { url: "http://localhost:4000/" }],
      "http://localhost:4000/",
    );
    // 3000はtombstoneで消え、4000は残るが前面には出ない
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:4000/"]);
    expect(store.activeBrowserTabId).toBe(null);
  });

  it("ターミナルへ戻った後でもブラウザタブを選び直せば、復元成功時にアクティブが維持される", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], null);
    store.beginRestore();
    store.showTerminal();
    store.selectBrowserTab(store.tabs[0].id);
    store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs.find((t) => t.id === store.activeBrowserTabId)?.url).toBe("http://localhost:3000/");
  });

  it("synced中の操作は記録されない（保存はwatcher経由で行われるため、次の復元に持ち越さない）", () => {
    store.applyServerState([{ url: "http://localhost:3000/" }], null);
    // synced中に開閉（watcherが保存する経路）
    const id = store.openBrowserTab("http://localhost:5000/");
    store.closeBrowserTab(id);
    // 再復元: 記録が無いのでサーバー状態そのまま
    store.beginRestore();
    const changed = store.applyServerState([{ url: "http://localhost:3000/" }], null);
    expect(store.tabs.map((t) => t.url)).toEqual(["http://localhost:3000/"]);
    expect(changed).toBe(false);
  });
});
