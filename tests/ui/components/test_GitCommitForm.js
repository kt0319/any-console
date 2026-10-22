// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import GitCommitForm from "../../../ui/components/GitCommitForm.vue";

const LINE_PX = 18;

describe("GitCommitForm 高さの自動調整", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => vi.restoreAllMocks());

  it("改行で伸び、クリアで1行に戻り、上限を超えたら内部スクロールにする", async () => {
    const wrapper = mount(GitCommitForm);
    const el = wrapper.find("textarea").element;
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => Math.max(1, el.value.split("\n").length) * LINE_PX });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ lineHeight: `${LINE_PX}px`, paddingTop: "6px", paddingBottom: "6px", borderTopWidth: "1px", borderBottomWidth: "1px" });
    wrapper.vm.commitMessage = "x";
    await nextTick();
    await nextTick();
    wrapper.vm.commitMessage = "";
    await nextTick();
    await nextTick();
    const height = () => parseFloat(el.style.height);
    const oneLine = height();

    await wrapper.find("textarea").setValue("a\nb\nc");
    await nextTick();
    expect(height()).toBeGreaterThan(oneLine);
    expect(el.style.overflowY).toBe("hidden");

    await wrapper.find("textarea").setValue(Array(20).fill("x").join("\n"));
    await nextTick();
    expect(el.style.overflowY).toBe("auto");
    const capped = height();
    expect(capped).toBeLessThan(20 * LINE_PX);

    wrapper.vm.commitMessage = "";
    await nextTick();
    await nextTick();
    expect(height()).toBe(oneLine);
    wrapper.unmount();
  });
});
