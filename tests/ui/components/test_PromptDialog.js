// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PromptDialog from "../../../ui/components/PromptDialog.vue";
import { usePrompt } from "../../../ui/composables/usePrompt.ts";

describe("PromptDialog の IME 対応", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("変換確定の Enter では送信せず、変換取消の Esc ではキャンセルしない（通常の Enter / Esc では動く）", async () => {
    const { prompt, visible } = usePrompt();
    const wrapper = mount(PromptDialog, { attachTo: document.body });
    const result = prompt({ title: "Name" });
    await flushPromises();
    const input = wrapper.find("input");
    await input.setValue("にほん");

    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await input.trigger("keydown", { key: "Enter", keyCode: 229 });
    await input.trigger("keydown", { key: "Escape", isComposing: true });
    await flushPromises();
    expect(visible.value).toBe(true);

    await input.trigger("keydown", { key: "Enter" });
    await expect(result).resolves.toBe("にほん");
    expect(visible.value).toBe(false);
    wrapper.unmount();
  });
});
