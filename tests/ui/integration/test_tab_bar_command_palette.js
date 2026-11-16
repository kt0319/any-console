// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: サイドバーを開いている間のタブバー（✕ボタン + コマンドパレット入力） */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TabBar from "../../../ui/components/TabBar.vue";
import { useLayoutStore } from "../../../ui/stores/layout.ts";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";

describe("TabBar: サイドバーを開いている間のコマンドパレット入力", () => {
  /** @type {import('@vue/test-utils').VueWrapper|null} */
  let wrapper = null;

  function mountTabBar({ narrow }) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const layoutStore = useLayoutStore();
    layoutStore.isNarrowViewport = narrow;
    const terminalStore = useTerminalStore();
    const tabs = [{ id: 1, sessionId: "s1", workspace: null, label: "one", wsIcon: null, icon: null }];
    terminalStore.openTabs = /** @type {any} */ (tabs);
    terminalStore.activeTabId = 1;
    wrapper = mount(TabBar, { props: { tabs: /** @type {any} */ (tabs) }, attachTo: document.body, global: { plugins: [pinia] } });
    return layoutStore;
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recent_jobs: [] }) })));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useLayoutStore().isSessionSidebarOpen = false;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("閉じている間は ☰ ボタンのみで検索入力は出ない", async () => {
    mountTabBar({ narrow: false });
    expect(wrapper.find(".tab-menu-btn .mdi-menu").exists()).toBe(true);
    expect(wrapper.find(".tab-bar-palette").exists()).toBe(false);
    expect(wrapper.find(".tab-bar-row-palette").exists()).toBe(false);
  });

  it("PCで開くと ✕ ボタンのままタブを残し、その右に検索入力を出す", async () => {
    const layoutStore = mountTabBar({ narrow: false });
    layoutStore.isSessionSidebarOpen = true;
    await flushPromises();

    const row = wrapper.find(".tab-bar-row");
    const firstButton = row.element.children[0];
    expect(firstButton.querySelector(".mdi-close")).not.toBeNull();
    expect(row.element.children[1].classList.contains("tab-bar-palette")).toBe(true);
    expect(wrapper.find(".tab-bar-palette").classes()).toContain("tab-bar-palette-inline");
    expect(wrapper.find(".tab-bar").attributes("style") ?? "").not.toContain("display: none");
  });

  it.each([["PC", false], ["モバイル", true]])("%s の✕ボタンはハイライトしない（アクティブ背景・下線を付けない）", async (_label, narrow) => {
    const layoutStore = mountTabBar({ narrow });
    layoutStore.isSessionSidebarOpen = true;
    await flushPromises();

    const button = wrapper.find(".tab-menu-btn");
    expect(button.classes()).not.toContain("active");
    expect(button.classes()).not.toContain("tab-underline-active");
  });

  it("モバイルで開くとタブ・＋・歯車を隠し、検索入力だけにする", async () => {
    const layoutStore = mountTabBar({ narrow: true });
    layoutStore.isSessionSidebarOpen = true;
    await flushPromises();

    expect(wrapper.find(".tab-bar-palette").exists()).toBe(true);
    expect(wrapper.find(".tab-bar-palette").classes()).not.toContain("tab-bar-palette-inline");
    expect(wrapper.find(".tab-bar").attributes("style")).toContain("display: none");
    const gear = wrapper.findAll(".tab-menu-btn").at(-1);
    expect(gear?.attributes("style")).toContain("display: none");
  });

  it("✕ ボタンでサイドバーを閉じると検索入力も消える", async () => {
    const layoutStore = mountTabBar({ narrow: false });
    layoutStore.isSessionSidebarOpen = true;
    await flushPromises();

    await wrapper.find(".tab-menu-btn").trigger("click");

    expect(layoutStore.isSessionSidebarOpen).toBe(false);
    expect(wrapper.find(".tab-bar-palette").exists()).toBe(false);
  });
});
