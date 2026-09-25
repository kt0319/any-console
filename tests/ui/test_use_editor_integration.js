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

  it("workspace_pathが`~/`始まりでも{host}と連結する前に絶対パスへ展開する", async () => {
    isTouchInputMock.mockReturnValue(false);
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { useEditorIntegration } = await freshModule();
    const { openInEditor, editorUrlTemplate, systemInfo } = useEditorIntegration();
    editorUrlTemplate.value = "zed://ssh/{user}@{host}{workspace_path}";
    systemInfo.value = { user: "k-takasaki", hostname: "mini.local", home_dir: "/Users/k-takasaki" };
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [{ name: "any-console", path: "~/work/any-console" }];
    workspaceStore.selectedWorkspace = "any-console";

    openInEditor("");

    expect(windowOpenSpy).toHaveBeenCalledWith(
      "zed://ssh/k-takasaki@mini.local/Users/k-takasaki/work/any-console",
      "_blank",
      "noopener,noreferrer",
    );
    windowOpenSpy.mockRestore();
  });
});
