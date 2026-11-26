// @vitest-environment happy-dom
// @ts-check
import { ref, computed } from "vue";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CircleKeypadConfig from "../../../ui/components/CircleKeypadConfig.vue";
import { useCircleKeypadConfigStore } from "../../../ui/stores/circle-keypad-config.ts";
import { defaultKeyDefs, defaultSpecialDefs } from "../../../ui/utils/circle-keypad-presets.ts";

function mountConfig() {
  return mount(CircleKeypadConfig, {
    attachTo: document.body,
    global: {
      provide: {
        modalTitle: ref(""),
        modalBranch: ref(""),
        viewState: computed(() => ({})),
        pushView: () => {},
        popView: () => {},
        updateViewState: () => {},
      },
    },
  });
}

describe("CircleKeypadConfig: プレビュー", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useCircleKeypadConfigStore();
    store.keys = defaultKeyDefs();
    store.specials = defaultSpecialDefs();
    store.enabled = true;
    store.loaded = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("8方向キーと四隅の割り当てを円形キーパッドとして描画する", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    const preview = wrapper.find(".ckpad-cfg-preview");
    expect(preview.exists()).toBe(true);
    expect(preview.findAll(".circle-keypad-item:not(.special)")).toHaveLength(8);
    const cornerLabels = preview.findAll(".circle-keypad-item.special").map((e) => e.text());
    expect(cornerLabels).toEqual(defaultSpecialDefs().map((s) => s.label));
    wrapper.unmount();
  });

  it("設定変更がプレビューへ即時反映される", async () => {
    const store = useCircleKeypadConfigStore();
    const wrapper = mountConfig();
    await flushPromises();
    store.specials[1] = { label: "Command Palette", action: "command-palette:open", payload: null };
    await flushPromises();
    const labels = wrapper.findAll(".ckpad-cfg-preview .circle-keypad-item.special").map((e) => e.text());
    expect(labels).toContain("Command Palette");
    wrapper.unmount();
  });

  it("プレビューのボタンをタップすると対応する設定行が強調され、再タップで解除される", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    const specialButtons = () => wrapper.findAll(".ckpad-cfg-preview .circle-keypad-item.special");
    const target = specialButtons()[1];

    await target.trigger("click");
    expect(specialButtons()[1].attributes("aria-pressed")).toBe("true");
    expect(specialButtons()[1].classes()).toContain("active");
    expect(wrapper.find("#ckpad-cfg-row-special-1").classes()).toContain("selected");
    expect(wrapper.findAll(".ckpad-cfg-row.selected")).toHaveLength(1);

    await specialButtons()[1].trigger("click");
    expect(specialButtons()[1].attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll(".ckpad-cfg-row.selected")).toHaveLength(0);
    wrapper.unmount();
  });

  it("別のボタンをタップすると強調が移る", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    const keyButtons = wrapper.findAll(".ckpad-cfg-preview .circle-keypad-item:not(.special)");

    await keyButtons[0].trigger("click");
    expect(wrapper.find("#ckpad-cfg-row-key-0").classes()).toContain("selected");
    await keyButtons[3].trigger("click");
    expect(wrapper.find("#ckpad-cfg-row-key-0").classes()).not.toContain("selected");
    expect(wrapper.find("#ckpad-cfg-row-key-3").classes()).toContain("selected");
    wrapper.unmount();
  });

  it("無効化中はプレビューを出さない", async () => {
    useCircleKeypadConfigStore().enabled = false;
    const wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.find(".ckpad-cfg-preview").exists()).toBe(false);
    wrapper.unmount();
  });
});
