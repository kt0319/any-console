// @ts-check
/**
 * useFileActions: 複数ファイルドロップ時の上書き衝突ハンドリング。
 * 「一部拒否」「全部拒否」でスキップ件数がトーストに反映されることを確認する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useFileActions } from "../../ui/composables/useFileActions.js";
import { useConfirm } from "../../ui/composables/useConfirm.js";
import { useWorkspaceStore } from "../../ui/stores/workspace.js";
import { useAuthStore } from "../../ui/stores/auth.js";
import { on } from "../../ui/app-bridge.js";

function fakeFile(name) {
  return { name };
}

function fakeEntry(name) {
  return { file: fakeFile(name), relativePath: name };
}

function jsonResponse(data) {
  return { ok: true, json: async () => data };
}

/** confirm() が呼ばれるのを待ってから解決する（onCancel/onOk は同じモジュール状態を共有） */
async function waitForConfirmThen(resolveFn) {
  const { visible } = useConfirm();
  for (let i = 0; i < 50 && !visible.value; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  resolveFn();
}

describe("useFileActions: 複数ファイルドロップの上書き衝突", () => {
  let toasts;
  let offToast;

  beforeEach(() => {
    setActivePinia(createPinia());
    useWorkspaceStore().selectedWorkspace = "ws1";
    toasts = [];
    offToast = on("toast:show", (payload) => toasts.push(payload));
  });

  afterEach(() => {
    offToast();
  });

  function setupAuthFetch({ existingNames = [], uploadOk = true }) {
    const auth = useAuthStore();
    auth.apiFetch = vi.fn(async (url) => {
      if (String(url).includes("/files?path=")) {
        return jsonResponse({ entries: existingNames.map((name) => ({ name })) });
      }
      if (String(url).includes("/upload")) {
        return { ok: uploadOk };
      }
      return jsonResponse({});
    });
    return auth;
  }

  it("一部のファイルが上書き拒否されると、成功件数とスキップ件数の両方をトーストする", async () => {
    setupAuthFetch({ existingNames: ["a.txt"] });
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });
    const { onCancel } = useConfirm();

    const done = uploadDroppedFiles([fakeEntry("a.txt"), fakeEntry("b.txt")]);
    await waitForConfirmThen(onCancel);
    await done;

    const messages = toasts.map((t) => t.message);
    expect(messages).toContain("1 file(s) uploaded");
    expect(messages).toContain("1 file(s) skipped (overwrite declined)");
  });

  it("全ファイルが上書き拒否されると、アップロード0件でもスキップ件数だけはトーストされる", async () => {
    setupAuthFetch({ existingNames: ["a.txt", "b.txt"] });
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });
    const { onCancel } = useConfirm();

    const done = uploadDroppedFiles([fakeEntry("a.txt"), fakeEntry("b.txt")]);
    await waitForConfirmThen(onCancel);
    await done;

    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toBe("2 file(s) skipped (overwrite declined)");
  });

  it("上書きを許可すると衝突ファイルもアップロードされ、スキップは発生しない", async () => {
    setupAuthFetch({ existingNames: ["a.txt"] });
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });
    const { onOk } = useConfirm();

    const done = uploadDroppedFiles([fakeEntry("a.txt"), fakeEntry("b.txt")]);
    await waitForConfirmThen(onOk);
    await done;

    expect(toasts.map((t) => t.message)).toEqual(["2 file(s) uploaded"]);
  });
});
