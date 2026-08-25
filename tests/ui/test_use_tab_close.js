// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

const emitMock = vi.fn();
vi.mock("../../ui/app-bridge.ts", () => ({
  emit: (...args) => emitMock(...args),
  on: vi.fn(() => () => {}),
}));

const detachTabMock = vi.fn();
vi.mock("../../ui/stores/terminal.ts", () => ({
  useTerminalStore: () => ({ detachTab: detachTabMock }),
}));

// confirm の戻り値（ダイアログでの選択）をテストごとに切り替える。
let confirmResult = /** @type {boolean | string} */ (true);
vi.mock("../../ui/composables/useConfirm.ts", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => confirmResult) }),
}));

const tab = { id: 7, workspace: "ws1", label: "ws1" };

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useTabClose.ts");
}

beforeEach(() => {
  emitMock.mockClear();
  detachTabMock.mockClear();
  confirmResult = true;
});

describe("useTabClose: 確認結果のディスパッチ", () => {
  it("Close 確定（true）は既定で tab:close を emit する", async () => {
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(emitMock).toHaveBeenCalledWith("tab:close", { tab });
    expect(detachTabMock).not.toHaveBeenCalled();
  });

  it("Close 確定（true）で onClose 指定時はそちらだけを呼ぶ", async () => {
    const { useTabClose } = await freshModule();
    const onClose = vi.fn();
    await useTabClose().confirmAndCloseTab(tab, onClose);
    expect(onClose).toHaveBeenCalledWith(tab);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('Refresh 選択（"refresh"）は tab:refresh を emit する', async () => {
    confirmResult = "refresh";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(emitMock).toHaveBeenCalledWith("tab:refresh", { tab });
    expect(detachTabMock).not.toHaveBeenCalled();
  });

  it('Detach 選択（"detach"）は terminalStore.detachTab を呼ぶ', async () => {
    confirmResult = "detach";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(detachTabMock).toHaveBeenCalledWith(tab.id);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("キャンセル（false）は何もしない", async () => {
    confirmResult = false;
    const { useTabClose } = await freshModule();
    const onClose = vi.fn();
    await useTabClose().confirmAndCloseTab(tab, onClose);
    expect(onClose).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
    expect(detachTabMock).not.toHaveBeenCalled();
  });
});
