// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.ts";

async function freshModules() {
  vi.resetModules();
  const [{ useSessionListOverlay }, { useExclusiveMobileOverlay }] = await Promise.all([
    import("../../ui/composables/useSessionListOverlay.js"),
    import("../../ui/composables/useExclusiveMobileOverlay.js"),
  ]);
  return { useSessionListOverlay, useExclusiveMobileOverlay };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// isSessionSidebarOpenはlocalStorageへ永続化される（layout.js参照）ため、
// open()したまま終わるテストが他ファイルの初期状態を汚さないよう、ストア
// 経由でfalseに戻しておく（watchがsafeFlagSave(false)を書き戻す）。
// vi.resetModules()後はグローバルのlocalStorage参照が失われるため直接
// localStorage.removeItemは呼べない（ストア経由なら問題ない）。
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
