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

  it("recipe 起点のラベルを、履歴項目側・リクエスト側のどちらからでも表示する", () => {
    const fromHistory = mount(DispatchQueueRowBody, {
      props: { request: { text: "fix" }, outcome: "executed", origin: "recipe:ci-fix" },
    });
    expect(fromHistory.find(".dispatch-queue-origin").text()).toBe("recipe:ci-fix");
    const fromRequest = mount(DispatchQueueRowBody, {
      props: { request: { text: "fix", origin: "recipe:ci-fix" } },
    });
    expect(fromRequest.find(".dispatch-queue-origin").text()).toBe("recipe:ci-fix");
    const manual = mount(DispatchQueueRowBody, { props: { request: { text: "fix" } } });
    expect(manual.find(".dispatch-queue-origin").exists()).toBe(false);
  });
});
