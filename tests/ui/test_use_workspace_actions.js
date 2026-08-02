// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.js", () => ({
  useApi: () => ({ apiGet: apiGetMock, wsEndpoint: (ws, path) => `/workspaces/${ws}/${path}` }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useWorkspaceActions.js");
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("useWorkspaceActions", () => {
  it("run一覧を取得しheadBranch/status/conclusionを含む形にマッピングする", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: {
        status: "ok",
        data: [{ databaseId: 1, displayTitle: "CI", status: "completed", conclusion: "success", headBranch: "main", url: "https://x" }],
      },
    });
    const { useWorkspaceActions } = await freshModule();
    const { fetchRuns, runsByWorkspace } = useWorkspaceActions();
    const items = await fetchRuns("ws1");
    expect(items).toEqual([{ id: 1, name: "CI", status: "completed", conclusion: "success", headBranch: "main", url: "https://x" }]);
    expect(runsByWorkspace.value.ws1).toEqual(items);
  });

  it("失敗時は空配列を返す", async () => {
    apiGetMock.mockResolvedValue({ ok: false, data: null });
    const { useWorkspaceActions } = await freshModule();
    const { fetchRuns } = useWorkspaceActions();
    expect(await fetchRuns("ws1")).toEqual([]);
  });

  it("同時に呼んでも同じワークスペースへのリクエストは1回だけ", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(new Promise((resolve) => { resolveApiGet = resolve; }));
    const { useWorkspaceActions } = await freshModule();
    const { fetchRuns } = useWorkspaceActions();

    const p1 = fetchRuns("ws1");
    const p2 = fetchRuns("ws1");
    resolveApiGet({ ok: true, data: { status: "ok", data: [] } });
    await Promise.all([p1, p2]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("workspace未指定なら何もフェッチせず空配列を返す", async () => {
    const { useWorkspaceActions } = await freshModule();
    const { fetchRuns } = useWorkspaceActions();
    expect(await fetchRuns("")).toEqual([]);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  describe("ポーリング", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      apiGetMock.mockResolvedValue({ ok: true, data: { status: "ok", data: [] } });
    });

    it("startPollingで一定間隔ごとに再取得し、stopPollingで止まる", async () => {
      const { useWorkspaceActions } = await freshModule();
      const { startPolling, stopPolling } = useWorkspaceActions();

      startPolling("ws1");
      expect(apiGetMock).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(10000);
      expect(apiGetMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10000);
      expect(apiGetMock).toHaveBeenCalledTimes(2);

      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(30000);
      expect(apiGetMock).toHaveBeenCalledTimes(2);
    });

    it("同じワークスペースへの複数startPollingは参照カウントされ、全員stopするまでタイマーが残る", async () => {
      const { useWorkspaceActions } = await freshModule();
      const { startPolling, stopPolling } = useWorkspaceActions();

      startPolling("ws1");
      startPolling("ws1");
      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(10000);
      expect(apiGetMock).toHaveBeenCalledTimes(1);

      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(10000);
      expect(apiGetMock).toHaveBeenCalledTimes(1);
    });

    afterEach(() => {
      vi.useRealTimers();
    });
  });
});
