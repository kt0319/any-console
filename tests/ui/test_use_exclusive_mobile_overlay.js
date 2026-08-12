// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.js";

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useExclusiveMobileOverlay.js");
}

function registerAll(registerOverlay, closed) {
  registerOverlay("sessionList", () => closed.push("sessionList"));
  registerOverlay("sessionOpen", () => closed.push("sessionOpen"));
  registerOverlay("settings", () => closed.push("settings"));
  registerOverlay("workspaceDetail", () => closed.push("workspaceDetail"));
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useExclusiveMobileOverlay", () => {
  it("モバイルでは4つ全てが互いに排他", async () => {
    useLayoutStore().isPanelBottom = true;
    const { useExclusiveMobileOverlay } = await freshModule();
    const { registerOverlay, closeOthersOn } = useExclusiveMobileOverlay();
    const closed = [];
    registerAll(registerOverlay, closed);

    closeOthersOn("sessionOpen");

    expect(closed.sort()).toEqual(["sessionList", "settings", "workspaceDetail"]);
  });

  it("PCではsessionOpenを開いてもsessionListは対象外で閉じない", async () => {
    useLayoutStore().isPanelBottom = false;
    const { useExclusiveMobileOverlay } = await freshModule();
    const { registerOverlay, closeOthersOn } = useExclusiveMobileOverlay();
    const closed = [];
    registerAll(registerOverlay, closed);

    closeOthersOn("sessionOpen");

    expect(closed.sort()).toEqual(["settings", "workspaceDetail"]);
  });

  it("PCでsessionListを開いても他の3つは閉じない", async () => {
    useLayoutStore().isPanelBottom = false;
    const { useExclusiveMobileOverlay } = await freshModule();
    const { registerOverlay, closeOthersOn } = useExclusiveMobileOverlay();
    const closed = [];
    registerAll(registerOverlay, closed);

    closeOthersOn("sessionList");

    expect(closed).toEqual([]);
  });

  it("PCでもsessionOpen/settings/workspaceDetailの3つは互いに排他", async () => {
    useLayoutStore().isPanelBottom = false;
    const { useExclusiveMobileOverlay } = await freshModule();
    const { registerOverlay, closeOthersOn } = useExclusiveMobileOverlay();
    const closed = [];
    registerOverlay("settings", () => closed.push("settings"));
    registerOverlay("workspaceDetail", () => closed.push("workspaceDetail"));

    closeOthersOn("settings");

    expect(closed).toEqual(["workspaceDetail"]);
  });

  it("未登録キーへのcloseOthersOnは何も起きない", async () => {
    useLayoutStore().isPanelBottom = true;
    const { useExclusiveMobileOverlay } = await freshModule();
    const { closeOthersOn } = useExclusiveMobileOverlay();
    expect(() => closeOthersOn("sessionList")).not.toThrow();
  });
});
