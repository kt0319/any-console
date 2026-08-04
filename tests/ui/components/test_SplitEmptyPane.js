// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SplitEmptyPane from "../../../ui/components/SplitEmptyPane.vue";
import { useLayoutStore } from "../../../ui/stores/layout.js";
import { useTerminalStore } from "../../../ui/stores/terminal.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SplitEmptyPane: 候補タブが1つだけの時の自動選択", () => {
  let layoutStore;
  let terminalStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    layoutStore = useLayoutStore();
    terminalStore = useTerminalStore();
  });

  it("候補タブが1つだけなら自動でそのペインに割り当てて開く", () => {
    terminalStore.openTabs = [{ id: 1, workspace: "repo-a" }];
    layoutStore.splitPaneTabIds = ["empty:1"];

    mount(SplitEmptyPane, { props: { paneIndex: 0 }, attachTo: document.body });

    expect(layoutStore.splitPaneTabIds[0]).toBe(1);
    expect(terminalStore.activeTabId).toBe(1);
  });

  it("候補タブが複数ある時は自動選択しない", () => {
    terminalStore.openTabs = [
      { id: 1, workspace: "repo-a" },
      { id: 2, workspace: "repo-b" },
    ];
    layoutStore.splitPaneTabIds = ["empty:1"];

    mount(SplitEmptyPane, { props: { paneIndex: 0 }, attachTo: document.body });

    expect(layoutStore.splitPaneTabIds[0]).toBe("empty:1");
  });

  it("候補タブが無い時は自動選択しない", () => {
    terminalStore.openTabs = [];
    layoutStore.splitPaneTabIds = ["empty:1"];

    mount(SplitEmptyPane, { props: { paneIndex: 0 }, attachTo: document.body });

    expect(layoutStore.splitPaneTabIds[0]).toBe("empty:1");
  });
});
