// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, h } from "vue";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalPaste } from "../../ui/composables/useTerminalPaste.ts";
import { uploadImageToTerminal } from "../../ui/utils/upload-image-to-terminal.ts";

vi.mock("../../ui/utils/upload-image-to-terminal.ts", () => ({
  uploadImageToTerminal: vi.fn().mockResolvedValue(true),
}));

function makeImageFile() {
  return new File(["x"], "image.png", { type: "image/png" });
}

describe("useTerminalPaste: 画像貼り付けの二重処理防止", () => {
  let wrapper;

  beforeEach(() => {
    setActivePinia(createPinia());
    uploadImageToTerminal.mockClear();
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

  it("画像貼り付け時はstopPropagationを呼びxterm自身のpasteリスナーへ伝播させない", async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    event.clipboardData = { files: [makeImageFile()], getData: () => "" };
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
    document.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadImageToTerminal).toHaveBeenCalledTimes(1);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("非アクティブなタブでは画像を処理しない", async () => {
    wrapper.unmount(); // beforeEachのアクティブなタブのリスナーを外してから検証する
    const Host2 = defineComponent({
      setup() {
        const tab = ref({ ws: { readyState: 1 }, term: { textarea: null, element: null } });
        const isActive = ref(false);
        useTerminalPaste({ tab, isActive });
        return () => h("div");
      },
    });
    const wrapper2 = mount(Host2, { attachTo: document.body });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    event.clipboardData = { files: [makeImageFile()], getData: () => "" };
    document.dispatchEvent(event);
    await Promise.resolve();
    expect(uploadImageToTerminal).not.toHaveBeenCalled();
    wrapper2.unmount();
  });
});
