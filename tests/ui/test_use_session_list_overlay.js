// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.ts";

async function freshModules() {
  vi.resetModules();
  const [{ useSessionListOverlay }, { useExclusiveMobileOverlay }] = await Promise.all([
    import("../../ui/composables/useSessionListOverlay.ts"),
    import("../../ui/composables/useExclusiveMobileOverlay.ts"),
  ]);
  return { useSessionListOverlay, useExclusiveMobileOverlay };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// isSessionSidebarOpenはlocalStorageへ永続化される（layout.js参照）ため、open()したまま
// 終わるテストが他ファイルを汚さないようストア経由でfalseに戻す（直接removeItemは不可）。
afterEach(() => {
  useLayoutStore().isSessionSidebarOpen = false;
});

describe("useSessionListOverlay", () => {
  it("open/closeがlayoutStore.isSessionSidebarOpenを反映する", async () => {
    const { useSessionListOverlay } = await freshModules();
    const { isOpen, open, close } = useSessionListOverlay();
    const layoutStore = useLayoutStore();

    expect(isOpen.value).toBe(false);
    open();
    expect(isOpen.value).toBe(true);
    expect(layoutStore.isSessionSidebarOpen).toBe(true);
    close();
    expect(isOpen.value).toBe(false);
    expect(layoutStore.isSessionSidebarOpen).toBe(false);
  });

  it("モバイルでopen()すると他の登録済みオーバーレイが閉じる", async () => {
    const { useSessionListOverlay, useExclusiveMobileOverlay } = await freshModules();
    useLayoutStore().isPanelBottom = true;
    const closed = [];
    useExclusiveMobileOverlay().registerOverlay("sessionOpen", () => closed.push("sessionOpen"));
    const { open } = useSessionListOverlay();

    open();

    expect(closed).toEqual(["sessionOpen"]);
  });

  it("PCでopen()しても他の登録済みオーバーレイは閉じない", async () => {
    const { useSessionListOverlay, useExclusiveMobileOverlay } = await freshModules();
    useLayoutStore().isPanelBottom = false;
    const closed = [];
    useExclusiveMobileOverlay().registerOverlay("sessionOpen", () => closed.push("sessionOpen"));
    const { open } = useSessionListOverlay();

    open();

    expect(closed).toEqual([]);
  });

  it("sessionListとして登録され、他キーからのcloseOthersOnで閉じる", async () => {
    const { useSessionListOverlay, useExclusiveMobileOverlay } = await freshModules();
    useLayoutStore().isPanelBottom = true;
    const { open, isOpen } = useSessionListOverlay();
    open();
    expect(isOpen.value).toBe(true);

    useExclusiveMobileOverlay().closeOthersOn("sessionOpen");

    expect(isOpen.value).toBe(false);
  });
});
