// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.ts";

// vi.resetModules()するとapp-bridge.tsも再読み込みされ、on/emitが別々の
// モジュールインスタンス（別々のリスナーレジストリ）を参照してイベントが
// 届かなくなるため、関連composable群とapp-bridgeを同じタイミングで動的
// importし、同一インスタンスを共有させる（useBranchActions系テストと同じ対策）。
async function freshModules() {
  vi.resetModules();
  const [{ useSettingsNav }, { useSessionListOverlay }, { useExclusiveMobileOverlay }, bridge] = await Promise.all([
    import("../../ui/composables/useSettingsNav.ts"),
    import("../../ui/composables/useSessionListOverlay.ts"),
    import("../../ui/composables/useExclusiveMobileOverlay.ts"),
    import("../../ui/app-bridge.ts"),
  ]);
  return { useSettingsNav, useSessionListOverlay, useExclusiveMobileOverlay, emit: bridge.emit };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// settings:open({view:'SessionList'})経由のリダイレクトはisSessionSidebarOpenを
// localStorageへ永続化する（layout.js参照）ため、他ファイルの初期状態を
// 汚さないよう、ストア経由でfalseに戻しておく（vi.resetModules()後はグローバル
// のlocalStorage参照が失われるため直接localStorage.removeItemは呼べない）。
afterEach(() => {
  useLayoutStore().isSessionSidebarOpen = false;
});

describe("useSettingsNav", () => {
  it("初期状態はルートビュー ModalMenu で isOpen=false", async () => {
    const { useSettingsNav } = await freshModules();
    const { currentView, isOpen, canNavigateBack } = useSettingsNav();
    expect(currentView.value).toBe("ModalMenu");
    expect(isOpen.value).toBe(false);
    expect(canNavigateBack.value).toBe(false);
  });

  it("引数無しのsettings:openはModalMenuを開く", async () => {
    const { useSettingsNav, emit } = await freshModules();
    const { isOpen, currentView } = useSettingsNav();

    emit("settings:open");

    expect(isOpen.value).toBe(true);
    expect(currentView.value).toBe("ModalMenu");
  });

  it("settings:open({view:'SessionList'})はセッション一覧オーバーレイへリダイレクトし、Settingsのスタックは開かない", async () => {
    const { useSettingsNav, useSessionListOverlay, emit } = await freshModules();
    const { isOpen: settingsOpen } = useSettingsNav();
    const { isOpen: sessionListOpen } = useSessionListOverlay();

    emit("settings:open", { view: "SessionList" });

    expect(sessionListOpen.value).toBe(true);
    expect(settingsOpen.value).toBe(false);
  });

  it("キーパッドプリセット由来のPreviewPortsはSessionPreviewとしてModalMenu配下に積まれる", async () => {
    const { useSettingsNav, emit } = await freshModules();
    const { viewStack } = useSettingsNav();

    emit("settings:open", { view: "PreviewPorts" });

    expect(viewStack.value.map((e) => e.view)).toEqual(["ModalMenu", "SessionPreview"]);
  });

  it("PairDeviceConfigはAuthConfigを経由して積まれる（戻るとAuthConfigに戻れる）", async () => {
    const { useSettingsNav, emit } = await freshModules();
    const { viewStack } = useSettingsNav();

    emit("settings:open", { view: "PairDeviceConfig" });

    expect(viewStack.value.map((e) => e.view)).toEqual(["ModalMenu", "AuthConfig", "PairDeviceConfig"]);
  });

  it("modal:closeでルートへ戻りisOpenがfalseになる", async () => {
    const { useSettingsNav, emit } = await freshModules();
    const { openView, isOpen, currentView } = useSettingsNav();
    openView("ModalMenu");
    expect(isOpen.value).toBe(true);

    emit("modal:close");

    expect(isOpen.value).toBe(false);
    expect(currentView.value).toBe("ModalMenu");
  });

  it("モバイルでopenViewすると他の登録済みオーバーレイが閉じる", async () => {
    const { useSettingsNav, useExclusiveMobileOverlay } = await freshModules();
    useLayoutStore().isPanelBottom = true;
    const closed = [];
    useExclusiveMobileOverlay().registerOverlay("sessionOpen", () => closed.push("sessionOpen"));
    const { openView } = useSettingsNav();

    openView("ModalMenu");

    expect(closed).toEqual(["sessionOpen"]);
  });
});
