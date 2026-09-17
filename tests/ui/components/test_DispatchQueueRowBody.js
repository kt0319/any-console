// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DispatchQueueRowBody from "../../../ui/components/DispatchQueueRowBody.vue";
import { expectNoA11yViolations } from "./axe-helper.js";

describe("DispatchQueueRowBody", () => {
  it.each([
    ["executed", "mdi-check-circle-outline"],
    ["failed", "mdi-alert-circle-outline"],
    ["discarded", "mdi-close-circle-outline"],
  ])("outcome=%s は %s アイコンと、色以外で判別できるラベルを付ける", async (outcome, icon) => {
    const wrapper = mount(DispatchQueueRowBody, {
      props: { request: { text: "echo hi" }, outcome },
      attachTo: document.body,
    });
    const iconEl = wrapper.find(".dispatch-queue-recent-head .mdi");
    expect(iconEl.classes()).toContain(icon);
    expect(iconEl.attributes("aria-label")).toBe(outcome);
    await expectNoA11yViolations(document.body);
    wrapper.unmount();
  });

  it("outcome が無い承認待ち行には結果アイコンを出さない", () => {
    const wrapper = mount(DispatchQueueRowBody, { props: { request: { text: "echo hi" } } });
    expect(wrapper.find(".dispatch-queue-recent-head").exists()).toBe(false);
  });
});
