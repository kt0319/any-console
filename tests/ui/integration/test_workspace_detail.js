// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: WorkspaceDetail */
import { defineComponent, ref } from "vue";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import WorkspaceDetail from "../../../ui/components/WorkspaceDetail.vue";

describe("WorkspaceDetail: terminal cwd files", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pane 更新時に terminalSessionId を保持する", async () => {
    const modalTitle = ref("");
    const modalBranch = ref("");
    const viewState = ref({
      detail: {
        pane: "files",
        terminalSessionId: "s1",
        rootLabel: "current-dir",
      },
    });
    const updateViewState = vi.fn((state) => {
      viewState.value = state;
    });

    const FileBrowserStub = defineComponent({
      template: "<div />",
      setup(_, { expose }) {
        expose({ load: vi.fn(), navigateToPath: vi.fn() });
      },
    });

    mount(WorkspaceDetail, {
      global: {
        provide: {
          modalTitle,
          modalBranch,
          viewState,
          updateViewState,
        },
        stubs: {
          FileBrowser: FileBrowserStub,
          GitHistory: true,
          GitChanges: true,
          GitChangeBranch: true,
          GitStash: true,
          WorkspaceJobsPane: true,
          GitHubIssuesPane: true,
          GitHubActionsPane: true,
          GitHubPRsPane: true,
          TerminalSelectPane: true,
        },
      },
    });
    await flushPromises();

    expect(updateViewState).toHaveBeenCalledWith({
      detail: {
        pane: "files",
        terminalSessionId: "s1",
        rootLabel: "current-dir",
      },
    });
    expect(viewState.value.detail.terminalSessionId).toBe("s1");
  });
});
