// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, h } from "vue";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../ui/utils/upload-image-to-terminal.js", () => ({
  uploadImageToTerminal: vi.fn().mockResolvedValue(true),
}));

function makeImageFile() {
  return new File(["x"], "image.png", { type: "image/png" });
}

function dispatchPasteWithImage() {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  event.clipboardData = { files: [makeImageFile()], getData: () => "" };
  document.dispatchEvent(event);
}

describe("useTerminalPaste: 画像貼り付けの重複防止", () => {
  let wrapper;
  let uploadImageToTerminal;

  beforeEach(async () => {
    setActivePinia(createPinia());
    // lastImagePasteAt はモジュールスコープの共有状態のため、テストごとに
    // モジュールをリセットして前のテストの状態を持ち越さないようにする。
    vi.resetModules();
    ({ uploadImageToTerminal } = await import("../../ui/utils/upload-image-to-terminal.js"));
    uploadImageToTerminal.mockClear();
    const { useTerminalPaste } = await import("../../ui/composables/useTerminalPaste.js");
    const Host = defineComponent({
      setup() {
        const tab = ref({ ws: { readyState: 1 }, term: { textarea: null, element: null } });
        const isActive = ref(true);
        useTerminalPaste({ tab, isActive });
        return () => h("div");
      },
    });
    wrapper = mount(Host, { attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("短時間に連続してpasteイベントが発火しても画像アップロードは1回だけ", async () => {
    dispatchPasteWithImage();
    dispatchPasteWithImage();
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadImageToTerminal).toHaveBeenCalledTimes(1);
  });

  it("十分な時間を空ければ再度アップロードされる", async () => {
    const base = Date.now();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(base);
    dispatchPasteWithImage();
    await Promise.resolve();
    now.mockReturnValue(base + 501);
    dispatchPasteWithImage();
    await Promise.resolve();
    expect(uploadImageToTerminal).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
