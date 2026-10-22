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
import { UNTRACKED_CONTENT_FETCH_CONCURRENCY } from "../../../ui/utils/constants.ts";

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

  it("作業ツリーの各ファイルのdiffを既定で展開表示し、行クリックで開閉・ボタンでFilesへ移動する", async () => {
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
    await wrapper.findAll(".diff-file-row")[0].trigger("click");
    expect(selected).toEqual([]);
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].text()).toContain("+y");

    await wrapper.findAll(".diff-file-row-open")[1].trigger("click");
    off();
    expect(selected).toEqual([{ path: "b.txt", isWorkingTree: true }]);
    expect(bodies()).toHaveLength(1);
    wrapper.unmount();
  });

  it.each(["??", "A", "AM"])("新規ファイル(%s)はインライン表示にファイル内容を出す", async (status) => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ path: "new.txt", status }], diff: "" })
      : jsonResponse({ content: "hello", size: 5 })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-inline-body").text()).toContain("hello");
    wrapper.unmount();
  });

  it("未追跡はUバッジで表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ path: "new.txt", status: "??" }], diff: "" })
      : jsonResponse({ content: "hello", size: 5 })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const badge = wrapper.find(".diff-file-row-status");
    expect(badge.text()).toBe("U");
    expect(badge.classes()).toContain("diff-status-untracked");
    wrapper.unmount();
  });

  it("未追跡ファイルは閉じて開き直しても内容を表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ path: "new.txt", status: "??" }], diff: "" })
      : jsonResponse({ content: "hello", size: 5 })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-inline-body").text()).toContain("hello");

    await wrapper.find(".diff-file-row").trigger("click");
    expect(wrapper.find(".diff-inline-body").exists()).toBe(false);
    await wrapper.find(".diff-file-row").trigger("click");
    await flushPromises();
    expect(wrapper.find(".diff-inline-body").text()).toContain("hello");
    wrapper.unmount();
  });

  it("未追跡ファイルの内容取得は1回の読み込みにつき1ファイル1回で、開き直しても増えず、再読込で取り直す", async () => {
    setupWorkspace();
    const fetchMock = vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ path: "new.txt", status: "??" }], diff: "" })
      : jsonResponse({ content: "hello", size: 5 }));
    vi.stubGlobal("fetch", fetchMock);
    const contentCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("file-content")).length;

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(contentCalls()).toBe(1);

    await wrapper.find(".diff-file-row").trigger("click");
    await wrapper.find(".diff-file-row").trigger("click");
    await flushPromises();
    expect(contentCalls()).toBe(1);

    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(contentCalls()).toBe(2);
    wrapper.unmount();
  });

  it("未追跡ファイルの内容取得の同時実行数は上限を超えない", async () => {
    setupWorkspace();
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `n${i}.txt`, status: "??" }));
    let active = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/diff")) return { ok: true, status: 200, json: async () => ({ files, diff: "" }) };
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, status: 200, json: async () => ({ content: "x", size: 1 }) };
    }));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(peak).toBeLessThanOrEqual(UNTRACKED_CONTENT_FETCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it("2回目以降の読み込みでは一覧をアンマウントせず、残ったパスの開閉状態を維持し、消えたパスは捨てる", async () => {
    setupWorkspace();
    let files = [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }];
    const chunk = (p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-x\n+y\n`;
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files, diff: files.map((f) => chunk(f.path)).join("") })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    await wrapper.findAll(".diff-file-row")[0].trigger("click");
    const listEl = wrapper.find(".diff-file-browser-list").element;
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);

    const reloading = wrapper.vm.loadWorkingTreeDiff();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain("Loading");
    await reloading;
    await flushPromises();
    expect(wrapper.find(".diff-file-browser-list").element).toBe(listEl);
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);

    files = [{ path: "b.txt", status: "M" }];
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    files = [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }];
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(2);
    wrapper.unmount();
  });

  it("ワークスペースが変わると開閉状態をリセットする", async () => {
    setupWorkspace();
    const files = [{ path: "a.txt", status: "M" }];
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files, diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n" })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    await wrapper.find(".diff-file-row").trigger("click");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(0);

    useWorkspaceStore().selectedWorkspace = "w2";
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(1);
    wrapper.unmount();
  });

  it("Filesへ移動しても行にハイライトを残さない", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [{ path: "a.txt", status: "M" }], diff: "" })));
    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    await wrapper.find(".diff-file-row-open").trigger("click");
    expect(wrapper.find(".diff-file-row").classes()).not.toContain("selected");
    wrapper.unmount();
  });
});
