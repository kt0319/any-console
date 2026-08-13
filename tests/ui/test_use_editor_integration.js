// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";

const isTouchInputMock = vi.fn(() => false);
const emitMock = vi.fn();

vi.mock("../../ui/utils/device.ts", () => ({
  isTouchInput: () => isTouchInputMock(),
}));

vi.mock("../../ui/app-bridge.ts", () => ({
  emit: (...args) => emitMock(...args),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useEditorIntegration.ts");
}

beforeEach(() => {
  setActivePinia(createPinia());
  isTouchInputMock.mockReset().mockReturnValue(false);
  emitMock.mockClear();
});

describe("useEditorIntegration: openInEditor のモバイル挙動", () => {
  it("タッチ端末ではエディタを開かずトーストで理由を明示する", async () => {
    isTouchInputMock.mockReturnValue(true);
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { useEditorIntegration } = await freshModule();
    const { openInEditor, editorUrlTemplate } = useEditorIntegration();
    editorUrlTemplate.value = "vscode://file/{workspace_path}";

    openInEditor("");

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith("toast:show", expect.objectContaining({ type: "info" }));
    windowOpenSpy.mockRestore();
  });

  it("PC（非タッチ）では従来通りエディタURLを開く", async () => {
    isTouchInputMock.mockReturnValue(false);
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { useEditorIntegration } = await freshModule();
    const { openInEditor, editorUrlTemplate } = useEditorIntegration();
    editorUrlTemplate.value = "vscode://file/{workspace_path}";
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [{ name: "repo", path: "/repo" }];
    workspaceStore.selectedWorkspace = "repo";

    openInEditor("src/index.js");

    expect(windowOpenSpy).toHaveBeenCalledWith("vscode://file//repo/src/index.js", "_blank", "noopener,noreferrer");
    expect(emitMock).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });
});
