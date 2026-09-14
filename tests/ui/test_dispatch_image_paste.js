// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useDispatchImagePaste } from "../../ui/composables/useDispatchImagePaste.ts";
import { uploadImageFile } from "../../ui/utils/upload-image.ts";

vi.mock("../../ui/utils/upload-image.ts", () => ({
  uploadImageFile: vi.fn(),
}));

function makeImageFile() {
  return new File(["x"], "image.png", { type: "image/png" });
}

function makePasteEvent(files) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  event.clipboardData = { files, getData: () => "" };
  return event;
}

describe("useDispatchImagePaste", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    uploadImageFile.mockReset();
  });

  it("uploads pasted image and appends its path", async () => {
    uploadImageFile.mockResolvedValue({ path: "/tmp/a.png", clipboard: false });
    const { imagePaths, previewUrls, onPaste } = useDispatchImagePaste();
    const event = makePasteEvent([makeImageFile()]);
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    await onPaste(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(imagePaths.value).toEqual(["/tmp/a.png"]);
    expect(previewUrls.value["/tmp/a.png"]).toMatch(/^blob:/);
  });

  it("accumulates multiple pastes", async () => {
    uploadImageFile
      .mockResolvedValueOnce({ path: "/tmp/a.png", clipboard: false })
      .mockResolvedValueOnce({ path: "/tmp/b.png", clipboard: false });
    const { imagePaths, onPaste } = useDispatchImagePaste();
    await onPaste(makePasteEvent([makeImageFile()]));
    await onPaste(makePasteEvent([makeImageFile()]));
    expect(imagePaths.value).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("ignores paste without an image file", async () => {
    const { imagePaths, onPaste } = useDispatchImagePaste();
    await onPaste(makePasteEvent([]));
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(imagePaths.value).toEqual([]);
  });

  it("removeImage drops the given path and its preview url", async () => {
    uploadImageFile
      .mockResolvedValueOnce({ path: "/tmp/a.png", clipboard: false })
      .mockResolvedValueOnce({ path: "/tmp/b.png", clipboard: false });
    const { imagePaths, previewUrls, onPaste, removeImage } = useDispatchImagePaste();
    await onPaste(makePasteEvent([makeImageFile()]));
    await onPaste(makePasteEvent([makeImageFile()]));
    removeImage("/tmp/a.png");
    expect(imagePaths.value).toEqual(["/tmp/b.png"]);
    expect(previewUrls.value["/tmp/a.png"]).toBeUndefined();
    expect(previewUrls.value["/tmp/b.png"]).toMatch(/^blob:/);
  });
});
