// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiGet: apiGetMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useBranchList.ts");
}

function jsonResponse(data) {
  return { ok: true, data };
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiGetMock.mockReset();
});

describe("useBranchList: リモートキャッシュの再フィルタ", () => {
  it("ローカルブランチ作成後にloadBranchListを呼ぶと、同名のリモートブランチがキャッシュから重複表示されない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    apiGetMock.mockImplementation((endpoint) => {
      if (endpoint === "/workspaces/repo/branches") {
        // 1回目はmainのみ、2回目（feature/x作成後）はfeature/xも追加
        return jsonResponse(apiGetMock.mock.calls.filter((c) => c[0] === "/workspaces/repo/branches").length === 1
          ? [{ name: "main", current: true }]
          : [{ name: "main", current: true }, { name: "feature/x", current: false }]);
      }
      if (endpoint === "/workspaces/repo/branches/remote") {
        return jsonResponse(["main", "feature/x"]);
      }
      if (endpoint === "/workspaces/repo/worktrees") {
        return jsonResponse({ worktrees: [] });
      }
      return jsonResponse(null);
    });

    const { useBranchList } = await freshModule();
    const { localBranches, remoteBranches, loadBranchList, loadRemoteBranches } = useBranchList();

    // 1. ローカルにはmainのみの状態でFetchし、リモート一覧をキャッシュさせる
    await loadBranchList();
    await loadRemoteBranches();
    expect(remoteBranches.value.map((b) => b.name)).toEqual(["feature/x"]);

    // 2. feature/xがローカルにも作成された後にloadBranchListだけを呼ぶ
    //    （キャッシュ由来のremoteBranchesがそのまま復元されると重複する）
    await loadBranchList();

    expect(localBranches.value.map((b) => b.name)).toContain("feature/x");
    expect(remoteBranches.value.map((b) => b.name)).not.toContain("feature/x");
  });
});
