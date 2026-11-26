// @vitest-environment happy-dom
/** GitHub ペイン（PRs / Issues / Actions）: 0件時の空状態メッセージと github_url 未設定時のメッセージ。 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import GitHubPRsPane from "../../../ui/components/GitHubPRsPane.vue";
import GitHubIssuesPane from "../../../ui/components/GitHubIssuesPane.vue";
import GitHubActionsPane from "../../../ui/components/GitHubActionsPane.vue";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import { expectNoA11yViolations } from "./axe-helper.js";

function jsonResponse(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data });
}

const PANES = [
  { name: "GitHubPRsPane", component: GitHubPRsPane, emptyMessage: "No open pull requests" },
  { name: "GitHubIssuesPane", component: GitHubIssuesPane, emptyMessage: "No open issues" },
  { name: "GitHubActionsPane", component: GitHubActionsPane, emptyMessage: "No workflow runs" },
];

function setupWorkspace() {
  setActivePinia(createPinia());
  const ws = useWorkspaceStore();
  ws.allWorkspaces = [{ name: "w1", github_url: "https://github.com/example/repo" }];
  ws.selectedWorkspace = "w1";
}

describe("GitHub panes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const { name, component, emptyMessage } of PANES) {
    it(`${name}: 0件なら空状態メッセージを表示する`, async () => {
      setupWorkspace();
      vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ status: "ok", data: [] })));

      const wrapper = mount(component, { attachTo: document.body });
      await flushPromises();
      expect(wrapper.text()).toContain(emptyMessage);
      await expectNoA11yViolations(wrapper.element);
      wrapper.unmount();
    });

    it(`${name}: github_url 未設定なら設定なしメッセージを表示する`, async () => {
      setActivePinia(createPinia());
      const fetchMock = vi.fn(() => jsonResponse({ status: "ok", data: [] }));
      vi.stubGlobal("fetch", fetchMock);

      const wrapper = mount(component, { attachTo: document.body });
      await flushPromises();
      expect(wrapper.text()).toContain("No GitHub repository configured");
      expect(wrapper.text()).not.toContain(emptyMessage);
      expect(fetchMock).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    // 取得失敗時は空状態にフォールバックせずエラーメッセージを表示すること（AsyncState 統合時の回帰防止）。
    it(`${name}: 取得失敗時はエラーメッセージを表示する`, async () => {
      setupWorkspace();
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })));

      const wrapper = mount(component, { attachTo: document.body });
      await flushPromises();
      expect(wrapper.text()).toContain("Failed to fetch");
      expect(wrapper.text()).not.toContain(emptyMessage);
      wrapper.unmount();
    });
  }
});
