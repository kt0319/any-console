// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FileItem from "../../../ui/components/FileItem.vue";

describe("FileItem", () => {
  it("renders the label", () => {
    const wrapper = mount(FileItem, { props: { label: "README.md" } });
    expect(wrapper.text()).toContain("README.md");
  });

  it("shows size and mtime columns when either is provided", () => {
    const wrapper = mount(FileItem, {
      props: { label: "a.txt", sizeText: "12 KB", mtimeText: "2h ago" },
    });
    expect(wrapper.find(".file-browser-item-size").exists()).toBe(true);
    expect(wrapper.find(".file-browser-item-mtime").exists()).toBe(true);
    expect(wrapper.text()).toContain("12 KB");
    expect(wrapper.text()).toContain("2h ago");
  });

  it("omits size and mtime columns when both are empty", () => {
    const wrapper = mount(FileItem, { props: { label: "a.txt" } });
    expect(wrapper.find(".file-browser-item-size").exists()).toBe(false);
    expect(wrapper.find(".file-browser-item-mtime").exists()).toBe(false);
  });

  it("keeps the mtime column even when sizeText is empty (directory case)", () => {
    const wrapper = mount(FileItem, {
      props: { label: "src", mtimeText: "1d ago" },
    });
    expect(wrapper.find(".file-browser-item-size").exists()).toBe(true);
    expect(wrapper.find(".file-browser-item-mtime").text()).toBe("1d ago");
  });

  it("applies gitignored modifier class", () => {
    const wrapper = mount(FileItem, {
      props: { label: "node_modules", gitignored: true },
    });
    expect(wrapper.classes()).toContain("gitignored");
  });

  it("emits click when the row is clicked", async () => {
    const wrapper = mount(FileItem, { props: { label: "x" } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeTruthy();
  });
});
