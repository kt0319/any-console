// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.js";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.js", () => ({
  useApi: () => ({
    apiGet: apiGetMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useGitLogPagination.js");
}

function jsonResponse(data) {
  return { ok: true, data };
}

// `git log --graph --pretty=format:%H\t%ad\t%an\t%D\t%s` 相当のstdout1行を組み立てる。
function graphLine(hash, message) {
  return `* ${hash}\t2026-08-12 12:00\ttester\t\t${message}`;
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiGetMock.mockReset();
});

describe("useGitLogPagination: 未pullコミット（unpulled-log）の統合", () => {
  it("loadHistoryはunpulled-logの結果を先頭にpending扱いで積む", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint.startsWith("/workspaces/repo/unpulled-log")) {
        return jsonResponse({ stdout: graphLine("f".repeat(40), "third commit") });
      }
      if (endpoint.startsWith("/workspaces/repo/git-log")) {
        return jsonResponse({ stdout: graphLine("a".repeat(40), "initial commit") });
      }
      return jsonResponse({ stdout: "" });
    });

    const { useGitLogPagination } = await freshModule();
    const { graphRows, loadHistory } = useGitLogPagination();
    await loadHistory();

    expect(graphRows.value).toHaveLength(2);
    expect(graphRows.value[0].entry.message).toBe("third commit");
    expect(graphRows.value[0].entry.pending).toBe(true);
    expect(graphRows.value[1].entry.message).toBe("initial commit");
    expect(graphRows.value[1].entry.pending).toBeUndefined();
  });

  it("upstream未設定などでunpulled-logが空stdoutの場合はpending行を追加しない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint.startsWith("/workspaces/repo/unpulled-log")) {
        return jsonResponse({ stdout: "" });
      }
      if (endpoint.startsWith("/workspaces/repo/git-log")) {
        return jsonResponse({ stdout: graphLine("a".repeat(40), "initial commit") });
      }
      return jsonResponse({ stdout: "" });
    });

    const { useGitLogPagination } = await freshModule();
    const { graphRows, loadHistory } = useGitLogPagination();
    await loadHistory();

    expect(graphRows.value).toHaveLength(1);
    expect(graphRows.value[0].entry.message).toBe("initial commit");
  });

  it("loadMoreHistoryでページを追加してもpending行は先頭に残り続ける", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint.startsWith("/workspaces/repo/unpulled-log")) {
        return jsonResponse({ stdout: graphLine("f".repeat(40), "pending commit") });
      }
      if (endpoint.startsWith("/workspaces/repo/git-log")) {
        // 常にlimit件ちょうど返す = hasMoreHistoryがtrueであり続ける
        return jsonResponse({ stdout: graphLine("a".repeat(40), "local commit") });
      }
      return jsonResponse({ stdout: "" });
    });

    const { useGitLogPagination } = await freshModule();
    const { graphRows, hasMoreHistory, loadHistory, loadMoreHistory } = useGitLogPagination();
    await loadHistory();
    expect(graphRows.value[0].entry.pending).toBe(true);

    // hasMoreHistoryをtrueにして手動でloadMoreHistoryを呼べるようにする
    hasMoreHistory.value = true;
    await loadMoreHistory();

    expect(graphRows.value[0].entry.pending).toBe(true);
    expect(graphRows.value[0].entry.message).toBe("pending commit");
    // unpulled-logは再取得されない（loadHistory時の1回のみ）
    const unpulledCalls = apiGetMock.mock.calls.filter((c) => c[0].startsWith("/workspaces/repo/unpulled-log"));
    expect(unpulledCalls).toHaveLength(1);
  });
});
