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
import { useConfirm } from "../../../ui/composables/useConfirm.ts";
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
    global: { stubs: { GitCommitDialog: true } },
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

  it("上部バーの全展開/全閉じを兼ねる1つのトグルボタンで全ファイルを一括開閉し、バーはファイル一覧より前に並ぶ", async () => {
    setupWorkspace();
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n";
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      files: [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "M" }],
      diff,
    })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const order = wrapper.html();
    expect(order.indexOf("diff-top-bar")).toBeLessThan(order.indexOf("diff-file-list"));

    const toggle = () => wrapper.find(".diff-expand-btn");
    expect(wrapper.findAll(".diff-expand-btn")).toHaveLength(1);
    const visibleLabel = () => toggle().find(".diff-expand-label > span:not(.diff-expand-label-hidden)").text();
    expect(visibleLabel()).toBe("Collapse all");
    expect(toggle().classes()).toContain("active");
    await toggle().trigger("click");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(0);
    expect(visibleLabel()).toBe("Expand all");
    expect(toggle().classes()).not.toContain("active");
    await toggle().trigger("click");
    expect(wrapper.findAll(".diff-inline-body")).toHaveLength(2);
    expect(visibleLabel()).toBe("Collapse all");
    expect(toggle().classes()).toContain("active");
    // 両ラベルを常に描画してボタン幅を固定する（状態で幅が変わらない）
    expect(toggle().findAll(".diff-expand-label > span")).toHaveLength(2);
    wrapper.unmount();
  });

  it("変更が無いときは Commit / Stash を無効にし、変更があれば Commit で Commit ダイアログを開く", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [], diff: "" })));
    const empty = mountGitChanges();
    await empty.vm.loadWorkingTreeDiff();
    await flushPromises();
    for (const button of empty.findAll(".diff-actions button")) expect(button.attributes("disabled")).toBeDefined();
    empty.unmount();

    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [{ path: "a.txt", status: "M" }], diff: "" })));
    const open = vi.fn();
    const wrapper = mount(GitChanges, { global: { stubs: { GitCommitDialog: { template: "<div />", setup: (_, { expose }) => expose({ open }) } } } });
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const commit = wrapper.findAll(".diff-actions button").find((b) => b.text() === "Commit");
    expect(commit.attributes("disabled")).toBeUndefined();
    await commit.trigger("click");
    expect(open).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("バー右端にステータス別件数と合計 numstat を表示する（ファイル数Fは出さない）", async () => {
    setupWorkspace();
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n k\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n";
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      files: [{ path: "a.txt", status: "M", insertions: 2, deletions: 1 }, { path: "b.txt", status: "M", insertions: 1, deletions: 1 }],
      diff,
    })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-total-numstat").text()).toBe("2M +3 -2");
    wrapper.unmount();
  });

  it("M/A/D/U のステータス別件数を0件を除いて表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      files: [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "D" }, { path: "c.txt", status: " D" }, { path: "d.txt", status: "??" }],
      diff: "",
    })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const text = wrapper.find(".diff-total-numstat").text();
    expect(text).toContain("1M 2D 1U");
    expect(text).not.toContain("F");
    expect(text).not.toContain("A");
    expect(wrapper.find(".diff-status-count.diff-status-del").text()).toBe("2D");
    wrapper.unmount();
  });

  it("Stash は確認ダイアログを開き、OK で stash を実行して一覧を再取得する", async () => {
    setupWorkspace();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (String(url).endsWith("/stash")) return jsonResponse({ status: "ok", stdout: "Saved" });
      return jsonResponse({ files: [{ path: "a.txt", status: "M" }], diff: "" });
    }));
    const { visible, message, onOk, onCancel } = useConfirm();

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const stash = wrapper.findAll(".diff-actions button").find((b) => b.text() === "Stash");
    await stash.trigger("click");
    expect(visible.value).toBe(true);
    expect(message.value).toContain("Stash 1 changed file,");
    expect(calls.some((c) => c.endsWith("/stash"))).toBe(false);

    await onOk();
    await flushPromises();
    expect(calls.filter((c) => c.startsWith("POST") && c.endsWith("/stash"))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith("/diff")).length).toBeGreaterThanOrEqual(2);

    await stash.trigger("click");
    onCancel();
    await flushPromises();
    expect(calls.filter((c) => c.startsWith("POST") && c.endsWith("/stash"))).toHaveLength(1);
    wrapper.unmount();
  });

  it("コンフリクト未解決のファイルがあると Stash は確認ダイアログを出さず、理由をトーストで示して実行しない", async () => {
    setupWorkspace();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      return jsonResponse({ files: [{ path: "open-api.yml", status: "UU" }, { path: "a.txt", status: "M" }], diff: "" });
    }));
    const toasts = [];
    const off = on("toast:show", (payload) => toasts.push(payload));
    const { visible } = useConfirm();

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    await wrapper.findAll(".diff-actions button").find((b) => b.text() === "Stash").trigger("click");
    off();
    expect(visible.value).toBe(false);
    expect(calls.some((c) => c.endsWith("/stash"))).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message).toContain("open-api.yml");
    expect(toasts[0].message).toContain("unresolved conflicts");
    wrapper.unmount();
  });

  it("進行中の操作（merge 等）があると Abort ボタンを出し、確認後に abort-operation を呼んで再取得する", async () => {
    setupWorkspace();
    const calls = [];
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (String(url).endsWith("/abort-operation")) {
        aborted = true;
        return jsonResponse({ status: "ok", stdout: "" });
      }
      return jsonResponse({
        files: aborted ? [] : [{ path: "open-api.yml", status: "UU" }],
        diff: "",
        operation: aborted ? null : "merge",
      });
    }));
    const { visible, message, onOk } = useConfirm();

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const abort = wrapper.find(".diff-abort-btn");
    expect(abort.text()).toBe("Abort merge");

    await abort.trigger("click");
    expect(visible.value).toBe(true);
    expect(message.value).toContain("Abort the merge?");
    expect(calls.some((c) => c.endsWith("/abort-operation"))).toBe(false);

    await onOk();
    await flushPromises();
    expect(calls.filter((c) => c.startsWith("POST") && c.endsWith("/abort-operation"))).toHaveLength(1);
    expect(wrapper.find(".diff-abort-btn").exists()).toBe(false);
    wrapper.unmount();
  });

  it("進行中の操作が無いときは Abort ボタンを出さない", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [{ path: "a.txt", status: "M" }], diff: "", operation: null })));
    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-abort-btn").exists()).toBe(false);
    wrapper.unmount();
  });

  it("コンフリクト中のファイルだけに Mark resolved を出し、確認後に mark-resolved を呼んで再取得する", async () => {
    setupWorkspace();
    const calls = [];
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn((url, init) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (String(url).endsWith("/mark-resolved")) {
        bodies.push(JSON.parse(init.body));
        return jsonResponse({ status: "ok", stdout: "" });
      }
      return jsonResponse({ files: [{ path: "open-api.yml", status: "UU" }, { path: "a.txt", status: "M" }], diff: "", operation: "merge" });
    }));
    const { visible, message, onOk } = useConfirm();

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const buttons = wrapper.findAll(".diff-file-row-resolve");
    expect(buttons).toHaveLength(1);
    expect(wrapper.findAll(".diff-file-row")[0].text()).toContain("open-api.yml");

    await buttons[0].trigger("click");
    expect(visible.value).toBe(true);
    expect(message.value).toContain("open-api.yml");
    expect(bodies).toEqual([]);

    await onOk();
    await flushPromises();
    expect(bodies).toEqual([{ path: "open-api.yml" }]);
    expect(calls.filter((c) => c.endsWith("/diff")).length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("変更が無いときは全展開/全閉じトグルを出さない", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ files: [], diff: "" })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-expand-btn").exists()).toBe(false);
    expect(wrapper.find(".diff-total-numstat").exists()).toBe(false);
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

  it("サーバが未追跡ファイルに行数（insertions）を付けて返しても、全文を表示し No diff にしない", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ name: "new.txt", status: "??", insertions: 2, deletions: 0 }], diff: "" })
      : jsonResponse({ content: "line1\nline2\n", size: 12 })));

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    const body = wrapper.find(".diff-inline-body").text();
    expect(body).toContain("line1");
    expect(body).not.toContain("No diff");
    expect(wrapper.find(".diff-total-numstat").text()).toContain("+2");
    wrapper.unmount();
  });

  it("差分（chunk）がある追加ファイルは内容を取得せず差分を表示する", async () => {
    setupWorkspace();
    const diff = "diff --git a/added.txt b/added.txt\nnew file mode 100644\n--- /dev/null\n+++ b/added.txt\n@@ -0,0 +1 @@\n+added\n";
    const fetchMock = vi.fn((url) => String(url).includes("/diff")
      ? jsonResponse({ files: [{ name: "added.txt", status: "A", insertions: 1, deletions: 0 }], diff })
      : jsonResponse({ content: "SHOULD-NOT-BE-FETCHED", size: 5 }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountGitChanges();
    await wrapper.vm.loadWorkingTreeDiff();
    await flushPromises();
    expect(wrapper.find(".diff-inline-body").text()).toContain("+added");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("file-content"))).toBe(false);
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
