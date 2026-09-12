// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GITHUB_POLL_INTERVAL_MS } from "../../ui/utils/constants.ts";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock, wsEndpoint: (ws, path) => `/workspaces/${ws}/${path}` }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useWorkspaceIssues.ts");
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe("useWorkspaceIssues", () => {
  it("issue一覧を取得しmapIssueと同じ形にマッピングする", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { status: "ok", data: [{ number: 1, title: "bug", state: "OPEN", author: { login: "kt" }, labels: [], comments: [{}] }] },
    });
    const { useWorkspaceIssues } = await freshModule();
    const { fetchIssues, issuesByWorkspace } = useWorkspaceIssues();
    const items = await fetchIssues("ws1");
    expect(items).toEqual([
      { number: 1, title: "bug", state: "open", author: "kt", labels: [], commentCount: 1, createdAt: null },
    ]);
    expect(issuesByWorkspace.value.ws1).toEqual(items);
  });

  it("初回失敗時は空配列を返す（キャッシュ無し）", async () => {
    apiGetMock.mockResolvedValue({ ok: false, data: null });
    const { useWorkspaceIssues } = await freshModule();
    const { fetchIssues } = useWorkspaceIssues();
    const items = await fetchIssues("ws1");
    expect(items).toEqual([]);
  });

  it("workspace未指定なら何もフェッチせず空配列を返す", async () => {
    const { useWorkspaceIssues } = await freshModule();
    const { fetchIssues } = useWorkspaceIssues();
    expect(await fetchIssues("")).toEqual([]);
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
      const { useWorkspaceIssues } = await freshModule();
      const { startPolling, stopPolling } = useWorkspaceIssues();

      startPolling("ws1");
      expect(apiGetMock).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS);
      expect(apiGetMock).toHaveBeenCalledTimes(1);

      stopPolling("ws1");
      await vi.advanceTimersByTimeAsync(GITHUB_POLL_INTERVAL_MS * 3);
      expect(apiGetMock).toHaveBeenCalledTimes(1);
    });
  });
});
