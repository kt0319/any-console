// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import GitActionBtn from "../../../ui/components/GitActionBtn.vue";

describe("GitActionBtn", () => {
  it("pull アイコンを描画する", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull" } });
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("push アイコンを描画する", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "push" } });
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("count が渡されると件数を表示する", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull", count: 3 } });
    expect(wrapper.find(".git-action-count").text()).toBe("3");
  });

  it("count が null のとき件数要素を表示しない", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull", count: null } });
    expect(wrapper.find(".git-action-count").exists()).toBe(false);
  });

  it("running=true のとき running クラスが付く", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "push", running: true } });
    expect(wrapper.classes()).toContain("running");
  });

  it("disabled=true のとき disabled クラスが付く", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "push", disabled: true } });
    expect(wrapper.classes()).toContain("disabled");
  });

  it("disabled=true のとき aria-disabled が付き action を emit しない", async () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull", disabled: true } });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
    await wrapper.trigger("click");
    expect(wrapper.emitted("action")).toBeFalsy();
  });

  it("disabled=false のとき aria-disabled が付かない", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull" } });
    expect(wrapper.attributes("aria-disabled")).toBeUndefined();
  });

  it("btnClass が追加のクラスとして反映される", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull", btnClass: "pull-btn has-count" } });
    expect(wrapper.classes()).toContain("pull-btn");
    expect(wrapper.classes()).toContain("has-count");
  });

  it("クリックで action イベントを emit する", async () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull" } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("action")).toBeTruthy();
    expect(wrapper.emitted("action")).toHaveLength(1);
  });

  it("title が aria-label と data-tooltip に反映される", () => {
    const wrapper = mount(GitActionBtn, { props: { icon: "pull", title: "Pull" } });
    expect(wrapper.attributes("aria-label")).toBe("Pull");
    expect(wrapper.attributes("data-tooltip")).toBe("Pull");
  });
});
