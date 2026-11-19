// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: コマンドパレット（セッションサイドバーの検索入力 → 絞り込み → 実行） */
import { defineComponent, h, nextTick } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { emit, on } from "../../../ui/app-bridge.ts";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import { useLayoutStore } from "../../../ui/stores/layout.ts";
import { useCommandPalette, useCommandPaletteOpener } from "../../../ui/composables/useCommandPalette.ts";
import { useSessionListOverlay } from "../../../ui/composables/useSessionListOverlay.ts";
import SessionListPanel from "../../../ui/components/SessionListPanel.vue";
import CommandPaletteInput from "../../../ui/components/CommandPaletteInput.vue";

const SessionListViewStub = { template: '<div class="session-list-stub"></div>' };

// タブバー側の検索入力（CommandPaletteInput）とサイドバー本体（SessionListPanel）を並べた状態。
const Harness = defineComponent({
  render: () => h("div", [h(CommandPaletteInput), h(SessionListPanel)]),
});

function mountPanel(pinia = createPinia()) {
  return mount(Harness, {
    attachTo: document.body,
    global: { plugins: [pinia], stubs: { SessionListView: SessionListViewStub } },
  });
}

// 入力を引数にした提案（Git / Terminal / Files グループ）は一致したコマンドの後ろに常に付くため、
// コマンド自体の検証では除く（提案は test_command_palette_query_actions.js で検証する）。
const QUERY_ACTION_GROUPS = ["Git", "Terminal", "Files"];

function labelsOf(wrapper) {
  return wrapper
    .findAll(".command-palette-item")
    .filter((row) => !QUERY_ACTION_GROUPS.includes(row.find(".command-palette-item-group").text()))
    .map((row) => row.find(".command-palette-item-label").text());
}

describe("コマンドパレット（サイドバー統合）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recent_jobs: [] }) })));
  });

  afterEach(() => {
    useCommandPalette().setQuery("");
    vi.unstubAllGlobals();
  });

  it("入力が空の間は従来どおりセッション一覧を表示する", async () => {
    const wrapper = mountPanel();
    expect(wrapper.find(".session-list-stub").exists()).toBe(true);
    expect(wrapper.find("[role=listbox]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("キー入力でセッション一覧が結果リストに切り替わり、空に戻すと元に戻る", async () => {
    const wrapper = mountPanel();
    const input = wrapper.find("input");

    await input.setValue("new term");
    expect(wrapper.find(".session-list-stub").exists()).toBe(false);
    expect(labelsOf(wrapper)).toEqual(["New Terminal"]);

    await input.setValue("");
    expect(wrapper.find(".session-list-stub").exists()).toBe(true);
    wrapper.unmount();
  });

  it("Enter で選択中の項目を実行し、検索をクリアして一覧へ戻る", async () => {
    const opened = vi.fn();
    const off = on("workspace:openModal", opened);
    const wrapper = mountPanel();
    const input = wrapper.find("input");

    await input.setValue("open session");
    expect(wrapper.findAll("[role=option]")).toHaveLength(1);
    await input.trigger("keydown", { key: "Enter" });

    expect(opened).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".session-list-stub").exists()).toBe(true);
    expect(/** @type {HTMLInputElement} */ (input.element).value).toBe("");
    off();
    wrapper.unmount();
  });

  it("入力が空のときの Enter では何も実行しない", async () => {
    const launched = vi.fn();
    const off = on("terminal:launch", launched);
    const wrapper = mountPanel();
    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(launched).not.toHaveBeenCalled();
    off();
    wrapper.unmount();
  });

  it("↑↓で選択位置が動き端で回り込む", async () => {
    const wrapper = mountPanel();
    const input = wrapper.find("input");
    await input.setValue("settings");
    const activeLabel = () => wrapper.find("[role=option].active .command-palette-item-label").text();

    expect(activeLabel()).toBe("Settings");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(activeLabel()).toBe("Settings | System Info");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(activeLabel()).toBe("Settings");
    wrapper.unmount();
  });

  describe("検索入力が下端のとき（タブバー下配置・スマホ）", () => {
    function mountBottom() {
      const pinia = createPinia();
      setActivePinia(pinia);
      useLayoutStore().isTabBarAtBottom = true;
      return mountPanel(pinia);
    }

    afterEach(() => {
      useLayoutStore().isTabBarAtBottom = false;
    });

    it("候補を下から積み、先頭の候補が入力に一番近い位置に来る", async () => {
      const wrapper = mountBottom();
      await wrapper.find("input").setValue("settings");
      expect(wrapper.find(".command-palette-list").classes()).toContain("from-bottom");
      wrapper.unmount();
    });

    it("上端のときは従来どおり上から積む", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      useLayoutStore().isTabBarAtBottom = false;
      const wrapper = mountPanel(pinia);
      await wrapper.find("input").setValue("settings");
      expect(wrapper.find(".command-palette-list").classes()).not.toContain("from-bottom");
      wrapper.unmount();
    });

    it("↑が次の候補、↓が前の候補（見た目の上下と一致させる）", async () => {
      const wrapper = mountBottom();
      const input = wrapper.find("input");
      await input.setValue("settings");
      const activeLabel = () => wrapper.find("[role=option].active .command-palette-item-label").text();

      expect(activeLabel()).toBe("Settings");
      await input.trigger("keydown", { key: "ArrowUp" });
      expect(activeLabel()).toBe("Settings | Terminal");
      await input.trigger("keydown", { key: "ArrowDown" });
      expect(activeLabel()).toBe("Settings");
      wrapper.unmount();
    });
  });

  it("Esc で入力をクリアし、そのイベントはサイドバーの Esc クローズへ伝えない", async () => {
    const wrapper = mountPanel();
    const input = wrapper.find("input");
    await input.setValue("settings");

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.element.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(/** @type {HTMLInputElement} */ (input.element).value).toBe("");
    wrapper.unmount();
  });

  it("一致する項目が無ければ空表示を出す", async () => {
    const wrapper = mountPanel();
    await wrapper.find("input").setValue("zzzz-no-match");
    expect(wrapper.findAll("[role=option]")).toHaveLength(0);
    expect(wrapper.find("[role=status]").text()).toBe("No matches");
    wrapper.unmount();
  });

  it("Settings の各画面を直接開く", async () => {
    const opened = vi.fn();
    const off = on("settings:open", opened);
    const wrapper = mountPanel();
    const input = wrapper.find("input");

    await input.setValue("settings circle");
    expect(labelsOf(wrapper)).toEqual(["Settings | Circle Keypad"]);
    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledWith({ view: "CircleKeypadConfig" });
    off();
    wrapper.unmount();
  });

  describe("ワークスペース", () => {
    function seedWorkspace(pinia, workspace) {
      setActivePinia(pinia);
      useWorkspaceStore().allWorkspaces = [workspace];
    }

    function seedActiveTab(pinia, workspace, extra = {}) {
      setActivePinia(pinia);
      const terminalStore = useTerminalStore();
      terminalStore.openTabs.push(/** @type {any} */ ({ id: 1, workspace, label: "", jobName: null, jobLabel: null, ...extra }));
      terminalStore.activeTabId = 1;
    }

    it("アクティブなタブのワークスペースのペインを直接開く", async () => {
      const pinia = createPinia();
      seedWorkspace(pinia, { name: "proj", is_git_repo: true });
      seedActiveTab(pinia, "proj");
      const opened = vi.fn();
      const off = on("git:openFileModal", opened);

      const wrapper = mountPanel(pinia);
      const input = wrapper.find("input");
      await input.setValue("detail");
      expect(labelsOf(wrapper)).toEqual(["proj | Files", "proj | History", "proj | Changes", "proj | Select & Copy"]);

      await input.setValue("changes");
      await input.trigger("keydown", { key: "Enter" });
      expect(opened).toHaveBeenCalledWith({ pane: "changes" });
      expect(useWorkspaceStore().selectedWorkspace).toBe("proj");
      off();
      wrapper.unmount();
    });

    it("アクティブなタブが無いときはペイン項目を出さない", async () => {
      const pinia = createPinia();
      seedWorkspace(pinia, { name: "proj", is_git_repo: true });
      const wrapper = mountPanel(pinia);
      await wrapper.find("input").setValue("detail");
      expect(wrapper.findAll("[role=option]")).toHaveLength(0);
      wrapper.unmount();
    });

    it("選んだワークスペースでターミナルを起動する", async () => {
      const pinia = createPinia();
      seedWorkspace(pinia, { name: "proj", icon: "mdi-rocket", icon_color: "#fff" });
      const launched = vi.fn();
      const off = on("terminal:launch", launched);

      const wrapper = mountPanel(pinia);
      const input = wrapper.find("input");
      await input.setValue("launch proj");
      expect(wrapper.findAll("[role=option]")).toHaveLength(1);
      await input.trigger("keydown", { key: "Enter" });
      expect(launched).toHaveBeenCalledWith({ workspace: "proj", icon: "mdi-rocket", iconColor: "#fff" });
      off();
      wrapper.unmount();
    });

    it("Launch 項目にワークスペースのアイコンを出し、無ければ既定アイコンにする", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      useWorkspaceStore().allWorkspaces = [
        { name: "with-icon", icon: "mdi-rocket", icon_color: "#ff0000" },
        { name: "no-icon" },
      ];
      const wrapper = mountPanel(pinia);
      await wrapper.find("input").setValue("launch");
      const icons = wrapper.findAll(".command-palette-item-icons");
      expect(icons[0].find(".mdi-rocket").attributes("style")).toContain("color:#ff0000");
      expect(icons[1].find(".mdi-console-line").exists()).toBe(true);
      wrapper.unmount();
    });

    it("Tab 項目にワークスペースとジョブの両方のアイコンを出す", async () => {
      const pinia = createPinia();
      seedActiveTab(pinia, "proj", {
        id: 7,
        jobName: "build",
        jobLabel: "Build",
        wsIcon: { name: "mdi-rocket", color: null },
        icon: { name: "mdi-hammer", color: "#00ff00" },
      });
      const wrapper = mountPanel(pinia);
      await wrapper.find("input").setValue("tabs");
      const icons = wrapper.find(".command-palette-item-icons");
      expect(icons.find(".mdi-rocket").exists()).toBe(true);
      expect(icons.find(".mdi-hammer").attributes("style")).toContain("color:#00ff00");
      wrapper.unmount();
    });

    it("狭い画面では実行後にセッション一覧のオーバーレイを閉じる", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const layoutStore = useLayoutStore();
      layoutStore.isSessionSidebarOpen = true;
      layoutStore.isNarrowViewport = true;
      const off = on("settings:open", () => {});

      const wrapper = mountPanel(pinia);
      const input = wrapper.find("input");
      await input.setValue("settings");
      await input.trigger("keydown", { key: "Enter" });

      expect(layoutStore.isSessionSidebarOpen).toBe(false);
      off();
      wrapper.unmount();
    });
  });

  describe("サイドバーを開いたときのフォーカス", () => {
    function stubTouchOnly(isTouchOnly) {
      vi.stubGlobal("matchMedia", vi.fn((query) => ({
        matches: isTouchOnly && query.includes("hover: none"),
        addEventListener: () => {},
        removeEventListener: () => {},
      })));
    }

    it("open() で開くと検索入力へフォーカスする（マウント済み）", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mountPanel(pinia);

      useSessionListOverlay().open();
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
    });

    it("open() 後にサイドバーが描画されたときもマウント時にフォーカスする", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      useSessionListOverlay().open();
      const wrapper = mountPanel(pinia);
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
    });

    it("開閉状態の復元だけ（open() を通らない）ではフォーカスを奪わない", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      useLayoutStore().isSessionSidebarOpen = true;

      const wrapper = mountPanel(pinia);
      await flushPromises();

      expect(document.activeElement).not.toBe(wrapper.find("input").element);
      wrapper.unmount();
    });

    it("タッチ専用端末では open() でフォーカスしない（ソフトキーボードの誤起動を避ける）", async () => {
      stubTouchOnly(true);
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mountPanel(pinia);

      useSessionListOverlay().open();
      await flushPromises();

      expect(document.activeElement).not.toBe(wrapper.find("input").element);
      wrapper.unmount();
    });

    it("コマンドパレットを明示して開く場合はタッチ専用端末でもフォーカスする", async () => {
      stubTouchOnly(true);
      const pinia = createPinia();
      setActivePinia(pinia);
      const opener = mount(defineComponent({ setup() { useCommandPaletteOpener(); return () => null; } }), { global: { plugins: [pinia] } });
      const wrapper = mountPanel(pinia);

      emit("command-palette:open");
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
      opener.unmount();
    });
  });

  describe("command-palette:open", () => {
    const Opener = defineComponent({
      setup() {
        useCommandPaletteOpener();
        return () => null;
      },
    });

    it("サイドバーを開き、マウント済みなら検索入力へフォーカスする", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const layoutStore = useLayoutStore();
      layoutStore.isSessionSidebarOpen = false;
      const opener = mount(Opener, { global: { plugins: [pinia] } });
      const wrapper = mountPanel(pinia);

      emit("command-palette:open");
      await flushPromises();

      expect(layoutStore.isSessionSidebarOpen).toBe(true);
      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
      opener.unmount();
    });

    it("検索入力にフォーカスがある状態でもう一度受けると、検索をクリアしてサイドバーを閉じる", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const layoutStore = useLayoutStore();
      layoutStore.isSessionSidebarOpen = false;
      const opener = mount(Opener, { global: { plugins: [pinia] } });
      const wrapper = mountPanel(pinia);

      emit("command-palette:open");
      await flushPromises();
      await wrapper.find("input").setValue("settings");
      expect(layoutStore.isSessionSidebarOpen).toBe(true);

      emit("command-palette:open");
      await flushPromises();

      expect(layoutStore.isSessionSidebarOpen).toBe(false);
      expect(useCommandPalette().query.value).toBe("");
      wrapper.unmount();
      opener.unmount();
    });

    it("サイドバーが開いていてもフォーカスが外れていれば、閉じずに検索入力へフォーカスする", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const layoutStore = useLayoutStore();
      layoutStore.isSessionSidebarOpen = true;
      const opener = mount(Opener, { global: { plugins: [pinia] } });
      const wrapper = mountPanel(pinia);
      await flushPromises();
      expect(document.activeElement).not.toBe(wrapper.find("input").element);

      emit("command-palette:open");
      await flushPromises();

      expect(layoutStore.isSessionSidebarOpen).toBe(true);
      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
      opener.unmount();
    });

    it("サイドバー未描画の間に要求されても、マウント時に検索入力へフォーカスする", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const opener = mount(Opener, { global: { plugins: [pinia] } });

      emit("command-palette:open");
      const wrapper = mountPanel(pinia);
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find("input").element);
      wrapper.unmount();
      opener.unmount();
    });
  });
});
