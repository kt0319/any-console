// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../ui/app-bridge.js", () => ({
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
}));

const apiGetMock = vi.fn();
const apiPutMock = vi.fn(async () => ({ ok: true, data: { status: "ok" } }));

vi.mock("../../ui/composables/useApi.js", () => ({
  useApi: () => ({ apiGet: apiGetMock, apiPut: apiPutMock }),
}));

vi.mock("../../ui/composables/useConfirm.js", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const job = (key, overrides = {}) => ({
  key,
  workspace: key.split(":")[0],
  jobName: key.split(":")[1],
  jobLabel: "",
  jobCommand: "echo hi",
  pinned: false,
  ...overrides,
});

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useRecentJobs.js");
}

beforeEach(() => {
  localStorage.clear();
  apiGetMock.mockReset();
  apiPutMock.mockClear();
  apiGetMock.mockResolvedValue({ ok: true, data: { pinned_jobs: [] } });
});

describe("useRecentJobs: サーバーとのピン留め同期", () => {
  it("togglePin でピン留め済みジョブ一覧をサーバーへ PUT する", async () => {
    localStorage.setItem("any_console_recent_jobs", JSON.stringify([job("ws1:build")]));
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs, togglePin } = useRecentJobs();
    await loadRecentJobs();

    await togglePin("ws1:build");

    expect(recentJobs.value.find((j) => j.key === "ws1:build").pinned).toBe(true);
    expect(apiPutMock).toHaveBeenCalledWith(
      "/pinned-jobs",
      { pinned_jobs: [expect.objectContaining({ key: "ws1:build" })] },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    );
  });

  it("サーバーのピン留めをローカル履歴とマージして読み込む", async () => {
    localStorage.setItem("any_console_recent_jobs", JSON.stringify([job("ws1:build")]));
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { pinned_jobs: [job("ws2:deploy", { pinned: true })] },
    });

    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    await loadRecentJobs();

    const keys = recentJobs.value.map((j) => j.key);
    expect(keys).toContain("ws1:build");
    expect(keys).toContain("ws2:deploy");
    expect(recentJobs.value.find((j) => j.key === "ws2:deploy").pinned).toBe(true);
    // サーバー未導入時からのローカル専用ピンは無いので移行 PUT は発生しない
    expect(apiPutMock).not.toHaveBeenCalled();
  });

  it("ローカルのみでピン留めされていた項目はサーバーへ移行される", async () => {
    localStorage.setItem(
      "any_console_recent_jobs",
      JSON.stringify([job("ws1:build", { pinned: true })]),
    );
    apiGetMock.mockResolvedValue({ ok: true, data: { pinned_jobs: [] } });

    const { useRecentJobs } = await freshModule();
    const { loadRecentJobs } = useRecentJobs();
    await loadRecentJobs();

    expect(apiPutMock).toHaveBeenCalledWith(
      "/pinned-jobs",
      { pinned_jobs: [expect.objectContaining({ key: "ws1:build" })] },
      expect.any(Object),
    );
  });
});
