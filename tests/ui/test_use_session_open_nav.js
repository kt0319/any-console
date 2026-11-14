// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.ts";

// useSessionOpenNav/useExclusiveOverlay/app-bridgeを同じタイミングで動的
// importし、resetModules後も同一インスタンスを共有させる（理由はtest_use_branch_actions.jsのfreshModuleを参照）。
async function freshModules() {
  vi.resetModules();
  const [{ useSessionOpenNav, openWorkspaceAdd }, { useExclusiveOverlay }, bridge] = await Promise.all([
    import("../../ui/composables/useSessionOpenNav.ts"),
    import("../../ui/composables/useExclusiveOverlay.ts"),
    import("../../ui/app-bridge.ts"),
  ]);
  return { useSessionOpenNav, openWorkspaceAdd, useExclusiveOverlay, emit: bridge.emit };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useSessionOpenNav", () => {
  it("初期状態はルートビュー WorkspaceOpen で isOpen=false", async () => {
    const { useSessionOpenNav } = await freshModules();
    const { currentView, isOpen, canNavigateBack } = useSessionOpenNav();
    expect(currentView.value).toBe("WorkspaceOpen");
    expect(isOpen.value).toBe(false);
    expect(canNavigateBack.value).toBe(false);
  });

  it("openViewで開き、pushView/popViewでスタックを積み戻しできる", async () => {
    const { useSessionOpenNav } = await freshModules();
    const { openView, pushView, popView, currentView, canNavigateBack, isOpen } = useSessionOpenNav();

    openView("WorkspaceOpen");
    expect(isOpen.value).toBe(true);
    expect(currentView.value).toBe("WorkspaceOpen");

    pushView("WorkspaceAdd", { path: "/x" });
    expect(currentView.value).toBe("WorkspaceAdd");
    expect(canNavigateBack.value).toBe(true);

    popView();
    expect(currentView.value).toBe("WorkspaceOpen");
    expect(canNavigateBack.value).toBe(false);
  });

  it("ルートでonBackするとcloseNav相当で閉じる", async () => {
    const { useSessionOpenNav } = await freshModules();
    const { openView, onBack, isOpen, currentView } = useSessionOpenNav();

    openView("WorkspaceOpen");
    expect(isOpen.value).toBe(true);

    onBack();

    expect(isOpen.value).toBe(false);
    expect(currentView.value).toBe("WorkspaceOpen");
  });

  it("workspace:openModalイベントでWorkspaceOpenが開く", async () => {
    const { useSessionOpenNav, emit } = await freshModules();
    const { isOpen, currentView } = useSessionOpenNav();

    emit("workspace:openModal");

    expect(isOpen.value).toBe(true);
    expect(currentView.value).toBe("WorkspaceOpen");
  });

  it("openWorkspaceAddでWorkspaceOpen→WorkspaceAddの順に積まれる", async () => {
    const { useSessionOpenNav, openWorkspaceAdd } = await freshModules();
    const { viewStack, currentView } = useSessionOpenNav();

    openWorkspaceAdd({ path: "/x" });

    expect(viewStack.value.map((e) => e.view)).toEqual(["WorkspaceOpen", "WorkspaceAdd"]);
    expect(currentView.value).toBe("WorkspaceAdd");
  });

  it("モバイルでopenViewすると他の登録済みオーバーレイが閉じる", async () => {
    const { useSessionOpenNav, useExclusiveOverlay } = await freshModules();
    useLayoutStore().isTabBarAtBottom = true;
    const closed = [];
    useExclusiveOverlay().registerOverlay("settings", () => closed.push("settings"));
    const { openView } = useSessionOpenNav();

    openView("WorkspaceOpen");

    expect(closed).toEqual(["settings"]);
  });
});
