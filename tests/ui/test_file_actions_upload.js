// @ts-check
/**
 * useFileActions: 複数ファイルドロップ時の上書き衝突ハンドリング。
 * 「一部拒否」「全部拒否」でスキップ件数がトースト、成功件数がfiles peekに反映されることを確認する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useFileActions } from "../../ui/composables/useFileActions.ts";
import { useConfirm } from "../../ui/composables/useConfirm.ts";
import { usePrompt } from "../../ui/composables/usePrompt.ts";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";
import { useAuthStore } from "../../ui/stores/auth.ts";
import { on } from "../../ui/app-bridge.ts";

const { triggerBlobDownloadMock } = vi.hoisted(() => ({ triggerBlobDownloadMock: vi.fn() }));
vi.mock("../../ui/utils/download.ts", () => ({ triggerBlobDownload: triggerBlobDownloadMock }));

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
  let fileOps;
  let offToast;
  let offFileOp;

  beforeEach(() => {
    setActivePinia(createPinia());
    useWorkspaceStore().selectedWorkspace = "ws1";
    toasts = [];
    fileOps = [];
    offToast = on("toast:show", (payload) => toasts.push(payload));
    offFileOp = on("files:opDone", (payload) => fileOps.push(payload));
  });

  afterEach(() => {
    offToast();
    offFileOp();
  });

  function setupAuthFetch({ existingNames = [], uploadOk = true, uploadResponse = null }) {
    const auth = useAuthStore();
    auth.apiFetch = vi.fn(async (url) => {
      if (String(url).includes("/files?path=")) {
        return jsonResponse({ entries: existingNames.map((name) => ({ name })) });
      }
      if (String(url).includes("/upload")) {
        return uploadResponse ? uploadResponse(url) : { ok: uploadOk };
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

    expect(fileOps).toEqual([{ wsName: "ws1", text: "1 file(s) uploaded" }]);
    expect(toasts.map((t) => t.message)).toEqual(["1 file(s) skipped (overwrite declined)"]);
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

    expect(fileOps).toEqual([{ wsName: "ws1", text: "2 file(s) uploaded" }]);
    expect(toasts).toEqual([]);
  });

  it("アップロード失敗時は失敗したファイル名とサーバの理由をトーストする", async () => {
    let call = 0;
    setupAuthFetch({
      uploadResponse: async () => (++call === 1
        ? { ok: false, status: 400, json: async () => ({ detail: "Invalid path" }) }
        : { ok: true }),
    });
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });

    await uploadDroppedFiles([
      { file: fakeFile("config"), relativePath: "proj/.git/config" },
      { file: fakeFile("ok.txt"), relativePath: "proj/ok.txt" },
    ]);

    expect(toasts.map((t) => t.message)).toEqual(["1 file(s) failed to upload: proj/.git/config (Invalid path)"]);
    expect(fileOps).toEqual([{ wsName: "ws1", text: "1 file(s) uploaded" }]);
  });

  it("理由がJSONで返らない失敗はHTTPステータスで示す", async () => {
    setupAuthFetch({ uploadResponse: async () => ({ ok: false, status: 413, json: async () => { throw new Error("not json"); } }) });
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });

    await uploadDroppedFiles([{ file: fakeFile("big.bin"), relativePath: "d/big.bin" }]);

    expect(toasts.map((t) => t.message)).toEqual(["1 file(s) failed to upload: d/big.bin (HTTP 413)"]);
  });

  it("素のターミナル（セッション指定）ではセッション用エンドポイントへアップロードする", async () => {
    useWorkspaceStore().selectedWorkspace = "";
    const auth = setupAuthFetch({});
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
      getTerminalSessionId: () => "sess 1",
    });

    await uploadDroppedFiles([
      { file: fakeFile("a.txt"), relativePath: "a.txt" },
      { file: fakeFile("x.js"), relativePath: "dir/x.js" },
    ]);

    const uploadUrls = auth.apiFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/upload"));
    expect(uploadUrls).toEqual(["/terminal/sessions/sess%201/upload", "/terminal/sessions/sess%201/upload"]);
    const listUrls = auth.apiFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/files?"));
    expect(listUrls).toEqual(["/terminal/sessions/sess%201/files?path="]);
    expect(toasts.map((t) => t.message)).toEqual(["2 file(s) uploaded"]);
    expect(fileOps).toEqual([]);
  });

  it("ワークスペースもセッションも無ければ何もアップロードしない", async () => {
    useWorkspaceStore().selectedWorkspace = "";
    const auth = setupAuthFetch({});
    const { uploadDroppedFiles } = useFileActions({
      getCurrentPath: () => "",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
    });
    await uploadDroppedFiles([fakeEntry("a.txt")]);
    expect(auth.apiFetch).not.toHaveBeenCalled();
  });

  it("素のターミナルではrename / deleteもセッション用エンドポイントを使う", async () => {
    useWorkspaceStore().selectedWorkspace = "";
    const auth = useAuthStore();
    auth.apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: "ok" }) }));
    const navigateToPath = vi.fn();
    const { moveCurrentPath, deleteCurrentPath } = useFileActions({
      getCurrentPath: () => "dir/a.txt",
      getFileContent: () => null,
      navigateToPath,
      getTerminalSessionId: () => "sess1",
    });

    const { onOk: confirmOk } = useConfirm();
    const moving = moveCurrentPath();
    const { visible: promptVisible, value: promptValue, onSubmit } = usePrompt();
    for (let i = 0; i < 50 && !promptVisible.value; i++) await new Promise((r) => setTimeout(r, 0));
    promptValue.value = "dir/b.txt";
    onSubmit();
    await moving;
    const deleting = deleteCurrentPath();
    await waitForConfirmThen(confirmOk);
    await deleting;

    const calls = auth.apiFetch.mock.calls.map(([url, opts]) => [String(url), opts.body]);
    expect(calls).toEqual([
      ["/terminal/sessions/sess1/rename", { src: "dir/a.txt", dest: "dir/b.txt" }],
      ["/terminal/sessions/sess1/delete-file", { path: "dir/a.txt" }],
    ]);
    expect(toasts.map((t) => t.message)).toEqual(["Renamed b.txt", "Deleted a.txt"]);
  });

  it("素のターミナルではdownloadもセッション用エンドポイントを使う", async () => {
    useWorkspaceStore().selectedWorkspace = "";
    const auth = useAuthStore();
    const blob = new Blob(["x"]);
    auth.apiFetch = vi.fn(async () => ({
      ok: true,
      blob: async () => blob,
      headers: { get: () => 'attachment; filename="dir.zip"' },
    }));
    const { downloadFile } = useFileActions({
      getCurrentPath: () => "dir",
      getFileContent: () => null,
      navigateToPath: vi.fn(),
      getTerminalSessionId: () => "sess1",
    });

    await downloadFile("dir");

    expect(auth.apiFetch).toHaveBeenCalledWith("/terminal/sessions/sess1/download?path=dir");
    expect(triggerBlobDownloadMock).toHaveBeenCalledWith(blob, "dir.zip");
  });
});
