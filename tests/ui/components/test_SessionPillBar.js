// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import SessionPillBar from "../../../ui/components/SessionPillBar.vue";
import { buildPillFields } from "../../../ui/utils/pill-fields.ts";
import { expectNoA11yViolations } from "./axe-helper.js";

function makePeek(peekingKey = "") {
  return {
    peekingKey: ref(peekingKey),
    peekColorClass: ref(""),
    peekIconClass: ref("mdi-source-branch"),
    peekText: ref("changed"),
    peekSignature: ref("sig"),
    branchPushCount: ref(0),
    branchPullCount: ref(0),
    branchRemoteResult: ref(null),
    peekActionName: ref(""),
    peekActionStatusText: ref(""),
    peekDurationMs: ref(1000),
  };
}

function mountBar(peek) {
  setActivePinia(createPinia());
  const pill = buildPillFields("app", { name: "app", is_git_repo: true, branch: "feature/x", clean: true }, {});
  const item = { ...pill, isWorktree: false, agent: { icon: "mdi-autorenew", label: "Working", className: "agent-state-working" } };
  return mount(SessionPillBar, {
    props: { item, tab: { workspace: "app", sessionId: "s1" }, peek },
    slots: { actions: '<button type="button" class="pill-close-btn" aria-label="Close tab">x</button>' },
    attachTo: document.body,
  });
}

describe("SessionPillBar", () => {
  it("左に状態アイコンとブランチ名、右にピルと操作ボタンを出す", async () => {
    const wrapper = mountBar(makePeek());
    expect(wrapper.find(".session-sidebar-branch-name").text()).toBe("feature/x");
    expect(wrapper.find(".session-sidebar-agent").attributes("aria-label")).toBe("Working");
    expect(wrapper.find(".session-sidebar-pills").exists()).toBe(true);
    expect(wrapper.find(".pill-close-btn").exists()).toBe(true);
    await expectNoA11yViolations(document.body);
    wrapper.unmount();
  });

  it("peek 中は peek ピルに差し替わり、操作ボタンを隠す", () => {
    const wrapper = mountBar(makePeek("branch"));
    expect(wrapper.find(".pill-peek-wide").exists()).toBe(true);
    expect(wrapper.find(".session-sidebar-pills").exists()).toBe(false);
    expect(wrapper.find(".pill-close-btn").exists()).toBe(false);
    wrapper.unmount();
  });
});
