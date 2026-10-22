// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import DiffFileBoxList from "../../../ui/components/DiffFileBoxList.vue";

const files = [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }];
const diffChunks = { "a.txt": "+a", "b.txt": "+b" };

describe("DiffFileBoxList", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("既定では全ファイルを展開し、行タップでそのファイルだけ閉じる", async () => {
    const wrapper = mount(DiffFileBoxList, { props: { files, diffChunks } });
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(2);
    await wrapper.findAll(".diff-file-row")[0].trigger("click");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);
  });

  it("defaultCollapsed では全ファイルを閉じて始め、行タップでそのファイルだけ開く", async () => {
    const wrapper = mount(DiffFileBoxList, { props: { files, diffChunks, defaultCollapsed: true } });
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(0);
    await wrapper.findAll(".diff-file-row")[1].trigger("click");
    const bodies = wrapper.findAll(".diff-inline-body");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].text()).toContain("+b");
  });
});
