// @vitest-environment happy-dom
/**
 * FileHistoryPane: 一覧取得（historyState）とdiff取得（diffState）を
 * AsyncState<T> に統合した際の表示確認。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FileHistoryPane from "../../../ui/components/FileHistoryPane.vue";
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

describe("FileHistoryPane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("一覧取得成功で履歴を表示する", async () => {
    setupWorkspace();
    const logLine = "abc123\t2026-01-01\tAlice\tfix: something";
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ stdout: logLine })));

    const wrapper = mount(FileHistoryPane, { props: { filePath: "foo.ts" } });
    await flushPromises();
    expect(wrapper.text()).toContain("fix: something");
    wrapper.unmount();
  });

  it("一覧取得失敗時はエラーメッセージを表示する", async () => {
    setupWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ detail: "boom" }) })));

    const wrapper = mount(FileHistoryPane, { props: { filePath: "foo.ts" } });
    await flushPromises();
    expect(wrapper.text()).toContain("boom");
    wrapper.unmount();
  });

  it("履歴を選択するとdiffを取得し、失敗時はエラーメッセージを表示する", async () => {
    setupWorkspace();
    const logLine = "abc123\t2026-01-01\tAlice\tfix: something";
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/file-diff/")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ detail: "diff boom" }) });
      }
      return jsonResponse({ stdout: logLine });
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(FileHistoryPane, { props: { filePath: "foo.ts" } });
    await flushPromises();
    await wrapper.find(".file-history-entry").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("diff boom");
    wrapper.unmount();
  });
});
