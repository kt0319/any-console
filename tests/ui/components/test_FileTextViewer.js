// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FileTextViewer from "../../../ui/components/FileTextViewer.vue";

const imageContent = { image: true, data_url: "data:image/png;base64,AAAA", size: 4 };
const touch = (x, y) => ({ clientX: x, clientY: y });

function mountImage() {
  return mount(FileTextViewer, { props: { fileContent: imageContent, fileName: "a.png" } });
}

describe("FileTextViewer 画像の拡大", () => {
  it("2本指のピンチアウトで拡大し、ピンチインで縮小する", async () => {
    const wrapper = mountImage();
    const wrap = wrapper.find(".file-content-image-wrap");
    const img = wrapper.find(".file-content-image");
    expect(img.attributes("style") ?? "").not.toContain("width");

    await wrap.trigger("touchstart", { touches: [touch(0, 0), touch(100, 0)] });
    await wrap.trigger("touchmove", { touches: [touch(0, 0), touch(200, 0)] });
    expect(img.attributes("style")).toContain("width: 200%");

    await wrap.trigger("touchmove", { touches: [touch(0, 0), touch(50, 0)] });
    expect(img.attributes("style")).toContain("width: 50%");
  });

  it("1本指の操作では拡大率を変えない", async () => {
    const wrapper = mountImage();
    const wrap = wrapper.find(".file-content-image-wrap");
    await wrap.trigger("touchstart", { touches: [touch(0, 0)] });
    await wrap.trigger("touchmove", { touches: [touch(50, 50)] });
    expect(wrapper.find(".file-content-image").attributes("style") ?? "").not.toContain("width");
  });

  it("ctrl+ホイール（トラックパッドのピンチ）で拡大する", async () => {
    const wrapper = mountImage();
    await wrapper.find(".file-content-image-wrap").trigger("wheel", { ctrlKey: true, deltaY: -50 });
    expect(wrapper.find(".file-content-image").attributes("style")).toContain("width:");
  });

  it("画像タップで拡大し、もう一度タップでフィットに戻る", async () => {
    const wrapper = mountImage();
    const img = wrapper.find(".file-content-image");
    await img.trigger("click");
    expect(img.attributes("style")).toContain("width: 200%");
    await img.trigger("click");
    expect(img.attributes("style") ?? "").not.toContain("width");
  });

  it("別の画像に切り替わると拡大率をフィットへ戻す", async () => {
    const wrapper = mountImage();
    await wrapper.find(".file-content-image").trigger("click");
    await wrapper.setProps({ fileContent: { ...imageContent, data_url: "data:image/png;base64,BBBB" } });
    expect(wrapper.find(".file-content-image").attributes("style") ?? "").not.toContain("width");
  });
});
