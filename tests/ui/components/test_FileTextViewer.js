// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FileTextViewer from "../../../ui/components/FileTextViewer.vue";

const imageContent = { image: true, data_url: "data:image/png;base64,AAAA", size: 4 };

describe("FileTextViewer 画像の拡大", () => {
  it("ボタンで拡大・縮小し、フィットで戻せる", async () => {
    const wrapper = mount(FileTextViewer, { props: { fileContent: imageContent, fileName: "a.png" } });
    const img = wrapper.find(".file-content-image");
    expect(img.attributes("style") ?? "").not.toContain("width");

    await wrapper.find('[aria-label="Zoom in"]').trigger("click");
    expect(img.attributes("style")).toContain("width: 150%");
    await wrapper.find('[aria-label="Zoom out"]').trigger("click");
    await wrapper.find('[aria-label="Zoom out"]').trigger("click");
    expect(img.attributes("style")).toContain("width: 50%");
    await wrapper.find('[aria-label="Fit to width"]').trigger("click");
    expect(img.attributes("style") ?? "").not.toContain("width");
  });

  it("画像タップで拡大し、もう一度タップでフィットに戻る", async () => {
    const wrapper = mount(FileTextViewer, { props: { fileContent: imageContent, fileName: "a.png" } });
    const img = wrapper.find(".file-content-image");
    await img.trigger("click");
    expect(img.attributes("style")).toContain("width: 200%");
    await img.trigger("click");
    expect(img.attributes("style") ?? "").not.toContain("width");
  });

  it("別の画像に切り替わると拡大率をフィットへ戻す", async () => {
    const wrapper = mount(FileTextViewer, { props: { fileContent: imageContent, fileName: "a.png" } });
    await wrapper.find(".file-content-image").trigger("click");
    await wrapper.setProps({ fileContent: { ...imageContent, data_url: "data:image/png;base64,BBBB" } });
    expect(wrapper.find(".file-content-image").attributes("style") ?? "").not.toContain("width");
  });
});
