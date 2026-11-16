// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: コマンドパレット（command-palette:open → 絞り込み → 実行） */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { emit, on } from "../../../ui/app-bridge.ts";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import CommandPalette from "../../../ui/components/CommandPalette.vue";

async function openPalette(pinia = createPinia()) {
  const wrapper = mount(CommandPalette, { attachTo: document.body, global: { plugins: [pinia] } });
  emit("command-palette:open");
  await flushPromises();
  return wrapper;
}

describe("CommandPalette", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recent_jobs: [] }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens with the built-in actions listed first", async () => {
    const wrapper = await openPalette();
    const labels = wrapper.findAll("[role=option]").map((o) => o.find(".command-palette-item-label").text());
    expect(labels.slice(0, 3)).toEqual(["New Terminal", "Open Session", "Settings"]);
    wrapper.unmount();
  });

  it("filters by the typed query and runs the selected item on Enter", async () => {
    const opened = vi.fn();
    const off = on("workspace:openModal", opened);
    const wrapper = await openPalette();
    const input = wrapper.find("input");

    await input.setValue("open session");
    expect(wrapper.findAll("[role=option]")).toHaveLength(1);

    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".command-palette").exists()).toBe(false);
    off();
    wrapper.unmount();
  });

  it("moves the selection with ArrowDown / ArrowUp and wraps around", async () => {
    const wrapper = await openPalette();
    const input = wrapper.find("input");
    const activeLabel = () => wrapper.find("[role=option].active .command-palette-item-label").text();

    expect(activeLabel()).toBe("New Terminal");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(activeLabel()).toBe("Open Session");
    await input.trigger("keydown", { key: "ArrowUp" });
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(activeLabel()).toBe("Settings | System Info");
    wrapper.unmount();
  });

  function seedWorkspace(pinia, workspace) {
    setActivePinia(pinia);
    useWorkspaceStore().allWorkspaces = [workspace];
  }

  function seedActiveTab(pinia, workspace) {
    setActivePinia(pinia);
    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push(/** @type {any} */ ({ id: 1, workspace, label: "", jobName: null, jobLabel: null }));
    terminalStore.activeTabId = 1;
  }

  it("offers the active tab's workspace panes and opens the selected one", async () => {
    const pinia = createPinia();
    seedWorkspace(pinia, { name: "proj", is_git_repo: true });
    seedActiveTab(pinia, "proj");
    const opened = vi.fn();
    const off = on("git:openFileModal", opened);

    const wrapper = await openPalette(pinia);
    const input = wrapper.find("input");
    await input.setValue("detail");
    const labels = wrapper.findAll(".command-palette-item-label").map((l) => l.text());
    expect(labels).toEqual(["proj | Files", "proj | History", "proj | Changes", "proj | Select & Copy"]);

    await input.setValue("changes");
    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledWith({ pane: "changes" });
    expect(useWorkspaceStore().selectedWorkspace).toBe("proj");
    off();
    wrapper.unmount();
  });

  it("hides workspace panes when no tab is active", async () => {
    const pinia = createPinia();
    seedWorkspace(pinia, { name: "proj", is_git_repo: true });
    const wrapper = await openPalette(pinia);
    await wrapper.find("input").setValue("detail");
    expect(wrapper.findAll("[role=option]")).toHaveLength(0);
    wrapper.unmount();
  });

  it("launches a terminal in the selected workspace", async () => {
    const pinia = createPinia();
    seedWorkspace(pinia, { name: "proj", icon: "mdi-rocket", icon_color: "#fff" });
    const launched = vi.fn();
    const off = on("terminal:launch", launched);

    const wrapper = await openPalette(pinia);
    const input = wrapper.find("input");
    await input.setValue("launch proj");
    expect(wrapper.findAll("[role=option]")).toHaveLength(1);

    await input.trigger("keydown", { key: "Enter" });
    expect(launched).toHaveBeenCalledWith({ workspace: "proj", icon: "mdi-rocket", iconColor: "#fff" });
    off();
    wrapper.unmount();
  });

  it("renders the workspace icon for Launch items and falls back to the default icon", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useWorkspaceStore().allWorkspaces = [
      { name: "with-icon", icon: "mdi-rocket", icon_color: "#ff0000" },
      { name: "no-icon" },
    ];
    const wrapper = await openPalette(pinia);
    await wrapper.find("input").setValue("launch");
    const icons = wrapper.findAll(".command-palette-item-icons");
    expect(icons[0].find(".mdi-rocket").attributes("style")).toContain("color:#ff0000");
    expect(icons[1].find(".mdi-console-line").exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders both the workspace and job icons for Tab items", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push(/** @type {any} */ ({
      id: 7,
      workspace: "proj",
      label: "",
      jobName: "build",
      jobLabel: "Build",
      wsIcon: { name: "mdi-rocket", color: null },
      icon: { name: "mdi-hammer", color: "#00ff00" },
    }));
    const wrapper = await openPalette(pinia);
    await wrapper.find("input").setValue("tabs");
    const icons = wrapper.find(".command-palette-item-icons");
    expect(icons.find(".mdi-rocket").exists()).toBe(true);
    expect(icons.find(".mdi-hammer").attributes("style")).toContain("color:#00ff00");
    wrapper.unmount();
  });

  it("lists the Settings views and opens the selected one directly", async () => {
    const opened = vi.fn();
    const off = on("settings:open", opened);
    const wrapper = await openPalette();
    const input = wrapper.find("input");

    await input.setValue("settings circle");
    expect(wrapper.findAll("[role=option]")).toHaveLength(1);
    expect(wrapper.find(".command-palette-item-label").text()).toBe("Settings | Circle Keypad");

    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledWith({ view: "CircleKeypadConfig" });
    off();
    wrapper.unmount();
  });

  it("keeps the top position fixed while the results shrink", async () => {
    const wrapper = await openPalette();
    const overlay = () => wrapper.find(".dialog-overlay");
    const initialPadding = overlay().element.style.paddingTop;
    expect(overlay().classes()).toContain("anchored");
    expect(initialPadding).not.toBe("");

    await wrapper.find("input").setValue("open session");
    expect(overlay().element.style.paddingTop).toBe(initialPadding);

    await wrapper.find("input").setValue("zzzz-no-match");
    expect(overlay().element.style.paddingTop).toBe(initialPadding);
    wrapper.unmount();
  });

  it("shows an empty state when nothing matches", async () => {
    const wrapper = await openPalette();
    await wrapper.find("input").setValue("zzzz-no-match");
    expect(wrapper.findAll("[role=option]")).toHaveLength(0);
    expect(wrapper.find("[role=status]").text()).toBe("No matches");
    wrapper.unmount();
  });
});
