// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GitCommitDialog from "../../../ui/components/GitCommitDialog.vue";
import { on } from "../../../ui/app-bridge.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";

function mountDialog() {
  return mount(GitCommitDialog, { attachTo: document.body });
}

async function typeMessage(text) {
  const textarea = document.querySelector("textarea");
  textarea.value = text;
  textarea.dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("GitCommitDialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const ws = useWorkspaceStore();
    ws.allWorkspaces = [{ name: "w1" }];
    ws.selectedWorkspace = "w1";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("open するまでは描画せず、open でダイアログを表示する", async () => {
    const wrapper = mountDialog();
    expect(document.querySelector(".commit-dialog")).toBeNull();
    wrapper.vm.open();
    await flushPromises();
    expect(document.querySelector(".commit-dialog")).not.toBeNull();
    wrapper.unmount();
  });

  it("メッセージが空（空白のみ含む）の間は Commit ボタンを無効にする", async () => {
    const wrapper = mountDialog();
    wrapper.vm.open();
    await flushPromises();
    const ok = () => document.querySelector(".dialog-btn-ok");
    expect(ok().disabled).toBe(true);
    await typeMessage("  \n ");
    expect(ok().disabled).toBe(true);
    await typeMessage("feat: x");
    expect(ok().disabled).toBe(false);
    wrapper.unmount();
  });

  it("Commit で API を呼び、成功したらダイアログを閉じてメッセージを消し commitDone を通知する", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "ok" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const done = [];
    const off = on("git:commitDone", () => done.push(true));
    const wrapper = mountDialog();
    wrapper.vm.open();
    await flushPromises();
    await typeMessage("feat: x\n\nbody");
    document.querySelector(".dialog-btn-ok").click();
    await flushPromises();
    off();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/workspaces/w1/commit");
    expect(JSON.parse(init.body)).toEqual({ message: "feat: x\n\nbody" });
    expect(done).toEqual([true]);
    expect(document.querySelector(".commit-dialog")).toBeNull();
    wrapper.vm.open();
    await flushPromises();
    expect(document.querySelector("textarea").value).toBe("");
    wrapper.unmount();
  });

  it("失敗したらダイアログを開いたままエラーを表示し、メッセージを保持する", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ detail: "boom" }) })));
    const wrapper = mountDialog();
    wrapper.vm.open();
    await flushPromises();
    await typeMessage("fix: y");
    document.querySelector(".dialog-btn-ok").click();
    await flushPromises();
    expect(document.querySelector(".commit-dialog")).not.toBeNull();
    expect(document.querySelector(".form-error")).not.toBeNull();
    expect(document.querySelector("textarea").value).toBe("fix: y");
    wrapper.unmount();
  });

  it("Cancel で閉じても、入力途中のメッセージは次に開いたとき残っている", async () => {
    const wrapper = mountDialog();
    wrapper.vm.open();
    await flushPromises();
    await typeMessage("wip");
    document.querySelector(".dialog-btn-cancel").click();
    await flushPromises();
    expect(document.querySelector(".commit-dialog")).toBeNull();
    wrapper.vm.open();
    await flushPromises();
    expect(document.querySelector("textarea").value).toBe("wip");
    wrapper.unmount();
  });
});
