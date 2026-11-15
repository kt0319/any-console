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

  it("opens with the built-in actions listed", async () => {
    const wrapper = await openPalette();
    const labels = wrapper.findAll("[role=option]").map((o) => o.find(".command-palette-item-label").text());
    expect(labels).toEqual(["New Terminal", "Open Session", "Settings"]);
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
    expect(activeLabel()).toBe("Settings");
    wrapper.unmount();
  });

  it("offers Workspace Detail for the active tab's workspace and opens it", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const terminalStore = useTerminalStore();
    const tab = /** @type {any} */ ({ id: 1, workspace: "proj", label: "", jobName: null, jobLabel: null });
    terminalStore.openTabs.push(tab);
    terminalStore.activeTabId = 1;
    const opened = vi.fn();
    const off = on("git:openFileModal", opened);

    const wrapper = await openPalette(pinia);
    await wrapper.find("input").setValue("detail");
    expect(wrapper.findAll("[role=option]")).toHaveLength(1);
    expect(wrapper.find(".command-palette-item-label").text()).toBe("Workspace Detail | proj");

    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore().selectedWorkspace).toBe("proj");
    off();
    wrapper.unmount();
  });

  it("hides Workspace Detail when no tab is active", async () => {
    const wrapper = await openPalette();
    await wrapper.find("input").setValue("detail");
    expect(wrapper.findAll("[role=option]")).toHaveLength(0);
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
