// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalImageDrop } from "../../ui/composables/useTerminalImageDrop.ts";
import { uploadImageToTerminal } from "../../ui/utils/upload-image-to-terminal.ts";

vi.mock("../../ui/utils/upload-image-to-terminal.ts", () => ({
  uploadImageToTerminal: vi.fn().mockResolvedValue(true),
}));

function makeDragEvent(type, files) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = {
    types: files.length > 0 ? ["Files"] : [],
    files,
  };
  return event;
}

describe("useTerminalImageDrop", () => {
  let tab;

  beforeEach(() => {
    setActivePinia(createPinia());
    uploadImageToTerminal.mockClear();
    tab = ref({ ws: { readyState: 1 } });
  });

  it("画像ファイルのドロップでuploadImageToTerminalを呼ぶ", async () => {
    const { onDrop } = useTerminalImageDrop({ tab });
    const file = new File(["x"], "image.png", { type: "image/png" });
    await onDrop(makeDragEvent("drop", [file]));
    expect(uploadImageToTerminal).toHaveBeenCalledTimes(1);
    expect(uploadImageToTerminal.mock.calls[0][0].file).toBe(file);
  });

  it("画像以外のファイルドロップではuploadImageToTerminalを呼ばない", async () => {
    const { onDrop } = useTerminalImageDrop({ tab });
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    await onDrop(makeDragEvent("drop", [file]));
    expect(uploadImageToTerminal).not.toHaveBeenCalled();
  });

  it("Files以外のドラッグ（タブ並び替え等）はisDropActiveを変化させない", () => {
    const { isDropActive, onDragEnter } = useTerminalImageDrop({ tab });
    onDragEnter(makeDragEvent("dragenter", []));
    expect(isDropActive.value).toBe(false);
  });

  it("dragenter/dragleaveの深さカウントでネスト要素間の出入りでも状態が消えない", () => {
    const { isDropActive, onDragEnter, onDragLeave } = useTerminalImageDrop({ tab });
    const file = new File(["x"], "image.png", { type: "image/png" });
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.appendChild(inner);

    const enterOuter = makeDragEvent("dragenter", [file]);
    onDragEnter(enterOuter);
    expect(isDropActive.value).toBe(true);

    const enterInner = makeDragEvent("dragenter", [file]);
    onDragEnter(enterInner);

    const leaveOuterToInner = makeDragEvent("dragleave", [file]);
    Object.defineProperty(leaveOuterToInner, "currentTarget", { value: outer });
    Object.defineProperty(leaveOuterToInner, "relatedTarget", { value: inner });
    onDragLeave(leaveOuterToInner);
    expect(isDropActive.value).toBe(true);

    const leaveInner = makeDragEvent("dragleave", [file]);
    Object.defineProperty(leaveInner, "currentTarget", { value: inner });
    Object.defineProperty(leaveInner, "relatedTarget", { value: null });
    onDragLeave(leaveInner);
    const leaveOuter = makeDragEvent("dragleave", [file]);
    Object.defineProperty(leaveOuter, "currentTarget", { value: outer });
    Object.defineProperty(leaveOuter, "relatedTarget", { value: null });
    onDragLeave(leaveOuter);
    expect(isDropActive.value).toBe(false);
  });
});
