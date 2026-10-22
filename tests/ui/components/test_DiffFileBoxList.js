// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
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

  it("chunk の無い追加ファイルは内容を取得せず No diff を表示する（作業ツリーの現在の内容を出さない）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(DiffFileBoxList, { props: { files: [{ path: "new.bin", status: "A" }], diffChunks: {} } });
    await flushPromises();
    expect(wrapper.find(".diff-inline-body").text()).toBe("No diff");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("files が変わると、消えたパスの開閉状態を捨てて残ったパスは維持する", async () => {
    const wrapper = mount(DiffFileBoxList, { props: { files, diffChunks } });
    await wrapper.findAll(".diff-file-row")[0].trigger("click");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);
    await wrapper.setProps({ files: [files[1]] });
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);
    await wrapper.setProps({ files });
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(2);
  });

  it("開閉ボタンの aria-expanded が開閉に追従し、ボタン操作（Enter/Space はネイティブ click）でも開閉できる", async () => {
    const wrapper = mount(DiffFileBoxList, { props: { files, diffChunks } });
    const toggle = () => wrapper.findAll(".diff-file-row-toggle")[0];
    expect(toggle().attributes("aria-expanded")).toBe("true");
    await toggle().trigger("click");
    expect(toggle().attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);
    await toggle().trigger("click");
    expect(toggle().attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(2);
  });

  it("defaultCollapsed では aria-expanded=false から始まる", () => {
    const wrapper = mount(DiffFileBoxList, { props: { files, diffChunks, defaultCollapsed: true } });
    expect(wrapper.findAll(".diff-file-row-toggle")[0].attributes("aria-expanded")).toBe("false");
  });
});
