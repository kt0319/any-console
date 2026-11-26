// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: TabItem */
import { markRaw } from "vue";
import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TabItem from "../../../ui/components/TabItem.vue";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";

describe("TabItem: markRawなtabの変更がtabWorkspaceVersion経由で再描画される", () => {
  // tab は markRaw のため tab.workspace/wsIcon/icon の直接読み取りは依存トラッキングされない。
  // setTabWorkspace/setTabJob が進める tabWorkspaceVersion を label/wsIconHtml/iconHtml の各 computed が読んでいないと、
  // 自動紐付け・ジョブ自動検知でタブ表示が更新されない（E2Eで再現した回帰）。
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("setTabWorkspaceでラベル・アイコンが即座に更新される", async () => {
    const terminalStore = useTerminalStore();
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [{ name: "proj", icon: "mdi-rocket", icon_color: "#f00", clean: true }];
    const tab = markRaw({ id: 1, sessionId: "s1", workspace: null, label: "terminal", wsIcon: null, icon: null, jobName: null, jobLabel: null });
    terminalStore.openTabs = [tab];

    const wrapper = mount(TabItem, { props: { tab, activeTabId: 1 } });
    expect(wrapper.get(".tab-extra").text()).toContain("terminal");
    expect(wrapper.find(".mdi-rocket").exists()).toBe(false);

    terminalStore.setTabWorkspace(1, "proj", { icon: "mdi-rocket", iconColor: "#f00" });
    await flushPromises();

    expect(wrapper.get(".tab-extra").text()).toContain("proj");
    expect(wrapper.find(".mdi-rocket").exists()).toBe(true);
  });

  it("worktreeのタブは、ベースのタブの右に続く時だけブランチ名を出し、ジョブアイコンは出さない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [
      { name: "proj:feat", worktree: true, worktree_base: "proj", branch: "feat/x", clean: true },
    ];
    const tab = markRaw({ id: 3, sessionId: "s3", workspace: "proj:feat", label: "proj", wsIcon: null, icon: { name: "mdi-rocket-launch", color: null }, jobName: null, jobLabel: null });
    useTerminalStore().openTabs = [tab];

    const head = mount(TabItem, { props: { tab, activeTabId: 3, inGroup: true, followsBase: false } });
    expect(head.get(".tab-extra").text()).toContain("proj");
    expect(head.get(".tab-extra").text()).not.toContain("feat/x");
    expect(head.find(".mdi-rocket-launch").exists()).toBe(true);

    const next = mount(TabItem, { props: { tab, activeTabId: 3, inGroup: true, followsBase: true } });
    expect(next.get(".tab-extra").text()).toContain("feat/x");
    expect(next.find(".worktree-icon").exists()).toBe(true);
    expect(next.find(".mdi-rocket-launch").exists()).toBe(false);
  });

  it("setTabJobでjobアイコンが即座に更新される", async () => {
    const terminalStore = useTerminalStore();
    const tab = markRaw({ id: 2, sessionId: "s2", workspace: null, label: "terminal", wsIcon: null, icon: null, jobName: null, jobLabel: null });
    terminalStore.openTabs = [tab];

    const wrapper = mount(TabItem, { props: { tab, activeTabId: 2 } });
    expect(wrapper.find(".mdi-rocket-launch").exists()).toBe(false);

    terminalStore.setTabJob(2, "job_x", "My Job", { icon: "mdi-rocket-launch", iconColor: "#f00" });
    await flushPromises();

    expect(wrapper.find(".mdi-rocket-launch").exists()).toBe(true);
  });
});
