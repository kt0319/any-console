// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GITHUB_POLL_INTERVAL_MS } from "../../ui/utils/constants.ts";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.js", () => ({
  useApi: () => ({ apiGet: apiGetMock, wsEndpoint: (ws, path) => `/workspaces/${ws}/${path}` }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useWorkspacePRs.js");
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("useWorkspacePRs", () => {
  it("PR一覧を取得しheadRefNameを含む形にマッピングする", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { status: "ok", data: [{ number: 1, title: "feat", headRefName: "feature/x", isDraft: false }] },
    });
    const { useWorkspacePRs } = await freshModule();
    const { fetchPRs, prsByWorkspace } = useWorkspacePRs();
    const items = await fetchPRs("ws1");
    expect(items).toEqual([{ number: 1, title: "feat", headRefName: "feature/x" }]);
    expect(prsByWorkspace.value.ws1).toEqual(items);
  });

  it("初回失敗時は空配列を返す（キャッシュ無し）", async () => {
    apiGetMock.mockResolvedValue({ ok: false, data: null });
    const { useWorkspacePRs } = await freshModule();
    const { fetchPRs } = useWorkspacePRs();
    const items = await fetchPRs("ws1");
    expect(items).toEqual([]);
  });

  it("成功後の失敗はキャッシュを空配列で潰さない", async () => {
    const { useWorkspacePRs } = await freshModule();
    const { fetchPRs, prsByWorkspace } = useWorkspacePRs();

    apiGetMock.mockResolvedValueOnce({
      ok: true,
      data: { status: "ok", data: [{ number: 1, title: "feat", headRefName: "feature/x" }] },
    });
    const first = await fetchPRs("ws1");
    expect(first).toHaveLength(1);

    apiGetMock.mockResolvedValueOnce({ ok: false, data: null });
    const second = await fetchPRs("ws1");
    expect(second).toEqual(first);
    expect(prsByWorkspace.value.ws1).toEqual(first);
  });

  it("同時に呼んでも同じワークスペースへのリクエストは1回だけ", async () => {
    let resolveApiGet;
    apiGetMock.mockReturnValue(new Promise((resolve) => { resolveApiGet = resolve; }));
    const { useWorkspacePRs } = await freshModule();
    const { fetchPRs } = useWorkspacePRs();

    const p1 = fetchPRs("ws1");
    const p2 = fetchPRs("ws1");
    resolveApiGet({ ok: true, data: { status: "ok", data: [] } });
    await Promise.all([p1, p2]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it("workspace未指定なら何もフェッチせず空配列を返す", async () => {
    const { useWorkspacePRs } = await freshModule();
    const { fetchPRs } = useWorkspacePRs();
    expect(await fetchPRs("")).toEqual([]);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  describe("ポーリング", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      apiGetMock.mockResolvedValue({ ok: true, data: { status: "ok", data: [] } });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("startPollingで一定間隔ごとに再取得し、stopPollingで止まる", async () => {
      const { useWorkspacePRs } = await freshModule();
      const { startPolling, stopPolling } = useWorkspacePRs();

      startPolling("ws1");
      expect(apiGetMock).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS);
      expect(apiGetMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS);
      expect(apiGetMock).toHaveBeenCalledTimes(2);

      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS * 3);
      expect(apiGetMock).toHaveBeenCalledTimes(2);
    });

    it("同じワークスペースへの複数startPollingは参照カウントされ、全員stopするまでタイマーが残る", async () => {
      const { useWorkspacePRs } = await freshModule();
      const { startPolling, stopPolling } = useWorkspacePRs();

      startPolling("ws1");
      startPolling("ws1");
      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS);
      expect(apiGetMock).toHaveBeenCalledTimes(1);

      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS);
      expect(apiGetMock).toHaveBeenCalledTimes(1);
    });
  });
});
