// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: CircleKeypadConfig のプレビュー（設定内容が円形キーパッドとして描画される） */
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

  it("無効化中はプレビューを出さない", async () => {
    useCircleKeypadConfigStore().enabled = false;
    const wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.find(".ckpad-cfg-preview").exists()).toBe(false);
    wrapper.unmount();
  });
});
