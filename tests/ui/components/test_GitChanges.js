// @vitest-environment happy-dom
/**
 * GitChanges: 作業ツリー/コミットのdiff取得状態をAsyncState<T>に統合した際の表示確認。
 * loadCommitDiff失敗時は元々エラー表示が無かったが、loadWorkingTreeDiff側と
 * 挙動を揃えてエラーメッセージを出すようにした（この変更点も検証する）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GitChanges from "../../../ui/components/GitChanges.vue";
import { on } from "../../../ui/app-bridge.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";

function jsonResponse(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data });
}

function setupWorkspace() {
  setActivePinia(createPinia());
  const ws = useWorkspaceStore();
  ws.allWorkspaces = [{ name: "w1" }];
  ws.selectedWorkspace = "w1";
}

function mountGitChanges() {
  return mount(GitChanges, {
    global: { stubs: { GitCommitForm: true } },
  });
}

describe("GitChanges", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("workspace未選択でloadWorkingTreeDiffを呼ぶとエラーメッセージを表示する", async () => {
    setActivePinia(createPinia());
    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.text()).toContain("No workspace selected");
    wrapper.unmount();
  });

  it("作業ツリーdiff取得成功で0件なら No changes を表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [], diff: "" })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.text()).toContain("No changes");
    wrapper.unmount();
  });

  it("作業ツリーdiff取得失敗時はエラーメッセージを表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.text()).toContain("Failed to load changes");
    wrapper.unmount();
  });

  it("コミットdiff取得失敗時はエラーメッセージを表示する（従来は無言で失敗していた挙動の改善）", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadCommitDiff("abc123");
    await flushPromises();
    expect(wrapper.text()).toContain("Failed to load commit diff");
    wrapper.unmount();
  });

  it("作業ツリーの各ファイルのdiffを常に展開表示し、行クリックでそのファイルへ移動する", async () => {
    setupWorkspace();
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n";
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      files: [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }],
      diff,
    })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const bodies = () => wrapper.findAll(".diff-inline-body");
    expect(bodies()).toHaveLength(2);
    expect(bodies()[0].text()).toContain("+new");
    expect(bodies()[1].text()).toContain("+y");

    const selected = [];
    const off = on("git:selectDiffFile", (detail) => selected.push(detail));
    await wrapper.findAll(".diff-file-row")[1].trigger("click");
    off();
    expect(selected).toEqual([{ path: "b.txt", isWorkingTree: true }]);
    expect(bodies()).toHaveLength(2);
    wrapper.unmount();
  });
});
