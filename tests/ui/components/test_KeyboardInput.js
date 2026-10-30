// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import KeyboardInput from "../../../ui/components/KeyboardInput.vue";

function mountInput() {
  return mount(KeyboardInput, {
    attachTo: document.body,
    props: { historyPrev: () => {}, historyNext: () => {} },
  });
}

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("KeyboardInput の中断された IME 変換状態", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    setVisibility("visible");
    document.body.innerHTML = "";
  });

  async function startComposition(wrapper) {
    const textarea = wrapper.find("textarea");
    await textarea.trigger("compositionstart");
    return textarea;
  }

  it("変換中は Enter を送信として扱わない（通常動作）", async () => {
    const wrapper = mountInput();
    const textarea = await startComposition(wrapper);
    await textarea.setValue("にほん");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toBeUndefined();
    wrapper.unmount();
  });

  it("compositionend が届かないまま blur しても、次の Enter は送信できる", async () => {
    const wrapper = mountInput();
    const textarea = await startComposition(wrapper);
    await textarea.setValue("にほん");
    await textarea.trigger("blur");
    await textarea.setValue("ls");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toHaveLength(1);
    expect(textarea.element.composing).toBe(false);
    wrapper.unmount();
  });

  it("compositionend が届かないまま PWA が前面復帰（visibilitychange）しても、Enter で送信できる", async () => {
    const wrapper = mountInput();
    const textarea = await startComposition(wrapper);
    await textarea.setValue("にほん");
    setVisibility("hidden");
    expect(wrapper.vm).toBeTruthy();
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toBeUndefined();
    setVisibility("visible");
    await flushPromises();
    const resumed = wrapper.find("textarea");
    await resumed.setValue("ls");
    await resumed.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toHaveLength(1);
    wrapper.unmount();
  });

  it("前面復帰時、フォーカスしていなければ textarea を作り直し、入力途中の draft は保持する", async () => {
    const wrapper = mountInput();
    const oldEl = wrapper.find("textarea").element;
    await wrapper.find("textarea").setValue("git st");
    setVisibility("hidden");
    setVisibility("visible");
    await flushPromises();
    const newEl = wrapper.find("textarea").element;
    expect(newEl).not.toBe(oldEl);
    expect(newEl.value).toBe("git st");
    wrapper.unmount();
  });

  it("前面復帰時、フォーカス中の textarea は作り直さない", async () => {
    const wrapper = mountInput();
    const el = wrapper.find("textarea").element;
    el.focus();
    setVisibility("visible");
    await flushPromises();
    expect(wrapper.find("textarea").element).toBe(el);
    wrapper.unmount();
  });

  it("pageshow（bfcache 復帰）でも変換状態を戻す", async () => {
    const wrapper = mountInput();
    const textarea = await startComposition(wrapper);
    window.dispatchEvent(new Event("pageshow"));
    await flushPromises();
    const resumed = wrapper.find("textarea");
    await resumed.setValue("ls");
    await resumed.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toHaveLength(1);
    wrapper.unmount();
  });

  it("送信後は textarea を作り直し、新しい要素は空で、古い要素の value には触れない", async () => {
    const wrapper = mountInput();
    const oldEl = wrapper.find("textarea").element;
    await wrapper.find("textarea").setValue("ls");
    wrapper.vm.submit();
    await flushPromises();
    expect(wrapper.emitted("submitted")).toHaveLength(1);
    const newEl = wrapper.find("textarea").element;
    expect(newEl).not.toBe(oldEl);
    expect(newEl.value).toBe("");
    expect(oldEl.value).toBe("ls");
    wrapper.unmount();
  });

  it("blur 時に変換が確定して input が飛んできても、送信後の draft は空になる", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("にほん");
    await textarea.trigger("compositionstart");
    const el = textarea.element;
    expect(el.composing).toBe(true);
    // iOS は blur() の中で未確定文字列を確定し、blur イベントより前に compositionend を同期で発火する
    const nativeBlur = el.blur.bind(el);
    el.blur = () => {
      el.value = "にほんご";
      el.dispatchEvent(new Event("compositionend"));
      nativeBlur();
    };
    wrapper.vm.submit();
    await flushPromises();
    const updates = wrapper.emitted("update:draft") || [];
    expect(updates[updates.length - 1]).toEqual([""]);
    expect(wrapper.find("textarea").element.value).toBe("");

    await wrapper.find("textarea").setValue("ls");
    await wrapper.find("textarea").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submitted")).toHaveLength(2);
    wrapper.unmount();
  });
});
