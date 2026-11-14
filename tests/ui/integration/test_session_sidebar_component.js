// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: SessionSidebar / SessionListView */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { emit, on } from "../../../ui/app-bridge.ts";
import SessionSidebar from "../../../ui/components/SessionSidebar.vue";
import SessionListView from "../../../ui/components/SessionListView.vue";
import { useLayoutStore } from "../../../ui/stores/layout.ts";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";
import { useAgentStateStore } from "../../../ui/stores/agent-state.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import { applyDispatchQueue } from "../../../ui/composables/useDispatchQueue.ts";

// ── SessionSidebar: ハンバーガーで開くセッション一覧 ─────────────────────────

describe("SessionSidebar: セッション選択とモバイル全面表示", () => {
  /** @type {import('@vue/test-utils').VueWrapper|null} */
  let wrapper = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    // 前のdescribe（DispatchRunView系）が残したdispatchキューはモジュール
    // スコープの共有stateのため、このdescribeへ漏れないようリセットする。
    applyDispatchQueue([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    // isSessionSidebarOpenはlocalStorageへ永続化される（layout.js参照）ため、
    // 他ファイルの初期状態を汚さないよう戻しておく。
    useLayoutStore().isSessionSidebarOpen = false;
  });

  function seedSidebar({ panelBottom = false } = {}) {
    const layoutStore = useLayoutStore();
    const terminalStore = useTerminalStore();
    const workspaceStore = useWorkspaceStore();
    layoutStore.isSessionSidebarOpen = true;
    layoutStore.isTabBarAtBottom = panelBottom;
    terminalStore.openTabs = [
      { id: 1, sessionId: "s1", workspace: "app", label: "app", wsIcon: null, icon: null },
      { id: 2, sessionId: "s2", workspace: null, label: "bare", wsIcon: null, icon: null },
    ];
    terminalStore.activeTabId = 1;
    workspaceStore.allWorkspaces = [
      { name: "app", branch: "main", clean: false, ahead: 2, behind: 0, changed_files: 1, insertions: 5, deletions: 2 },
    ];
    // SessionSidebar.vueはPC専用（モバイルはSessionListOverlay.vueが同じ中身を全面オーバーレイで出す）
    // なので、行の中身自体（SessionListView.vue）を直接マウントして両パターンを検証する。
    wrapper = panelBottom
      ? mount(SessionListView, { attachTo: document.body })
      : mount(SessionSidebar, { attachTo: document.body });
    return { layoutStore, terminalStore };
  }

  it("幅をキー操作で変更・保存し、狭い画面ではハンドルを表示しない", async () => {
    const { layoutStore } = seedSidebar();
    layoutStore.sessionSidebarWidth = 320;
    const handle = wrapper.find('[role="separator"]');
    await handle.trigger("keydown", { key: "ArrowRight" });
    expect(layoutStore.sessionSidebarWidth).toBe(336);
    expect(handle.attributes("aria-valuenow")).toBe("336");
    expect(JSON.parse(localStorage.getItem("any_console_session_sidebar_width"))).toBe(336);
    await handle.trigger("keydown", { key: "Home" });
    expect(layoutStore.sessionSidebarWidth).toBe(240);
    await handle.trigger("keydown", { key: "End" });
    expect(Number(handle.attributes("aria-valuenow"))).toBe(Number(handle.attributes("aria-valuemax")));
    layoutStore.isNarrowViewport = true;
    await flushPromises();
    expect(wrapper.find('[role="separator"]').exists()).toBe(false);
    localStorage.removeItem("any_console_session_sidebar_width");
  });

  it("ドラッグで幅を変更し、終了後は追従を止める", async () => {
    const { layoutStore } = seedSidebar();
    layoutStore.sessionSidebarWidth = 320;
    const handle = wrapper.find('[role="separator"]');
    handle.element.setPointerCapture = vi.fn();
    handle.element.hasPointerCapture = vi.fn(() => true);
    handle.element.releasePointerCapture = vi.fn();
    await handle.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 320 });
    await handle.trigger("pointermove", { pointerId: 1, clientX: 400 });
    expect(layoutStore.sessionSidebarWidth).toBe(400);
    await handle.trigger("pointerup", { pointerId: 1 });
    await handle.trigger("pointermove", { pointerId: 1, clientX: 450 });
    expect(layoutStore.sessionSidebarWidth).toBe(400);
    expect(handle.element.releasePointerCapture).toHaveBeenCalledWith(1);
    localStorage.removeItem("any_console_session_sidebar_width");
  });

  it("エージェント状態がある行は行2のブランチアイコンを、ステータスのアイコンに置き換える", async () => {
    const { terminalStore } = seedSidebar();
    useAgentStateStore().agentStates.s1 = "working";
    await flushPromises();
    const rows = wrapper.findAll(".session-sidebar-item");
    expect(rows).toHaveLength(2);
    const row1s = wrapper.findAll(".session-sidebar-row1");
    expect(row1s[0].classes()).toContain("active");
    expect(rows[1].text()).toContain("bare");
    const lis = wrapper.findAll(".session-sidebar-li");
    expect(lis[0].text()).toContain("main");
    expect(lis[0].text()).not.toContain("Working");
    const icon = lis[0].find(".session-sidebar-meta .session-sidebar-agent");
    expect(icon.attributes("aria-label")).toBe("Working");
    expect(lis[0].find(".session-sidebar-meta .mdi-source-branch").exists()).toBe(false);
  });

  it("エージェント状態が無い行は行2にブランチ名だけ表示する", async () => {
    seedSidebar();
    await flushPromises();
    const lis = wrapper.findAll(".session-sidebar-li");
    expect(lis[0].text()).toContain("main");
    expect(lis[0].text()).not.toContain("Working");
    expect(lis[0].find(".session-sidebar-meta .mdi-source-branch").exists()).toBe(true);
    expect(lis[0].find(".session-sidebar-agent").exists()).toBe(false);
  });

  it("PC: 行クリックで tab:select が emit されサイドバーは開いたまま", async () => {
    const { layoutStore } = seedSidebar({ panelBottom: false });
    const selected = [];
    const off = on("tab:select", (detail) => selected.push(detail));
    await wrapper.findAll(".session-sidebar-item")[1].trigger("click");
    off();
    expect(selected).toHaveLength(1);
    expect(selected[0].tab.id).toBe(2);
    expect(selected[0].skipFocus).toBe(false);
    expect(layoutStore.isSessionSidebarOpen).toBe(true);
  });

  it("モバイル: 行選択でtab:selectがemitされる（skipFocus付き）がサイドバーは閉じない", async () => {
    const { layoutStore } = seedSidebar({ panelBottom: true });
    const selected = [];
    const off = on("tab:select", (detail) => selected.push(detail));
    await wrapper.findAll(".session-sidebar-item")[1].trigger("click");
    off();
    expect(selected).toHaveLength(1);
    expect(selected[0].skipFocus).toBe(true);
    // タブ切替えではサイドバー/オーバーレイを閉じない（モバイルでも同様）。
    expect(layoutStore.isSessionSidebarOpen).toBe(true);
  });

  it("モバイル: アクティブな行の選択は tab:select を出さない（サイドバーも閉じない）", async () => {
    const { layoutStore } = seedSidebar({ panelBottom: true });
    const selected = [];
    const off = on("tab:select", (detail) => selected.push(detail));
    await wrapper.findAll(".session-sidebar-item")[0].trigger("click");
    off();
    expect(selected).toHaveLength(0);
    expect(layoutStore.isSessionSidebarOpen).toBe(true);
  });

  it("Esc でサイドバーが閉じる", async () => {
    const { layoutStore } = seedSidebar();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flushPromises();
    expect(layoutStore.isSessionSidebarOpen).toBe(false);
  });

  it("分割モード中も開いていれば表示する", async () => {
    const { layoutStore } = seedSidebar();
    layoutStore.isSplitMode = true;
    await flushPromises();
    expect(wrapper.find(".session-sidebar").exists()).toBe(true);
  });
});
