// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../ui/app-bridge.ts", () => ({
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
}));

const apiGetMock = vi.fn();
const apiPutMock = vi.fn(async () => ({ ok: true, data: { status: "ok" } }));

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock, apiPut: apiPutMock }),
}));

vi.mock("../../ui/composables/useConfirm.ts", () => ({
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
  return import("../../ui/composables/useRecentJobs.ts");
}

beforeEach(() => {
  localStorage.clear();
  apiGetMock.mockReset();
  apiPutMock.mockClear();
  apiGetMock.mockResolvedValue({ ok: true, data: { recent_jobs: [] } });
});

// localStorage は --localstorage-file 経由でディスク上のファイルを共有するため、
// 他のテストファイルへ漏れないよう最後に必ず後始末する。
afterAll(() => {
  localStorage.clear();
});

describe("useRecentJobs: サーバーとの同期", () => {
  it("recordJob で Recent Jobs 一覧全体をサーバーへ PUT する", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: { recent_jobs: [] } });
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs, recordJob } = useRecentJobs();
    await loadRecentJobs();

    recordJob({ name: "ws1" }, { name: "build", command: "make build" });

    expect(recentJobs.value.find((j) => j.key === "ws1:build")).toBeTruthy();
    expect(apiPutMock).toHaveBeenCalledWith(
      "/recent-jobs",
      { recent_jobs: expect.arrayContaining([expect.objectContaining({ key: "ws1:build" })]) },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    );
  });

  it("togglePin でピン留め状態を含む一覧をサーバーへ PUT する", async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: { recent_jobs: [job("ws1:build")] } });
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs, togglePin } = useRecentJobs();
    await loadRecentJobs();

    await togglePin("ws1:build");

    expect(recentJobs.value.find((j) => j.key === "ws1:build").pinned).toBe(true);
    expect(apiPutMock).toHaveBeenCalledWith(
      "/recent-jobs",
      { recent_jobs: expect.arrayContaining([expect.objectContaining({ key: "ws1:build", pinned: true })]) },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    );
  });

  it("removeRecentJob で対象を除いた一覧をサーバーへ PUT する", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { recent_jobs: [job("ws1:build"), job("ws2:deploy")] },
    });
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs, removeRecentJob } = useRecentJobs();
    await loadRecentJobs();

    await removeRecentJob("ws1:build");

    expect(recentJobs.value.map((j) => j.key)).toEqual(["ws2:deploy"]);
    expect(apiPutMock).toHaveBeenCalledWith(
      "/recent-jobs",
      { recent_jobs: [expect.objectContaining({ key: "ws2:deploy" })] },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    );
  });

  it("サーバーの Recent Jobs 一覧を正として読み込む", async () => {
    localStorage.setItem("any_console_recent_jobs", JSON.stringify([job("stale:local")]));
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { recent_jobs: [job("ws2:deploy", { pinned: true })] },
    });

    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    await loadRecentJobs();

    const keys = recentJobs.value.map((j) => j.key);
    expect(keys).toEqual(["ws2:deploy"]);
    expect(apiPutMock).not.toHaveBeenCalled();
  });

  it("サーバー応答前はローカルキャッシュを暫定表示する", async () => {
    localStorage.setItem("any_console_recent_jobs", JSON.stringify([job("ws1:build")]));
    let resolveGet;
    apiGetMock.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    const loadPromise = loadRecentJobs();

    expect(recentJobs.value.map((j) => j.key)).toEqual(["ws1:build"]);

    resolveGet({ ok: true, data: { recent_jobs: [] } });
    await loadPromise;
    expect(recentJobs.value).toEqual([]);
  });

  it("非ピン留めの履歴は RECENT_JOBS_MAX(10)件を超えると古い順に切り捨てる", async () => {
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs, recordJob } = useRecentJobs();
    await loadRecentJobs();

    for (let i = 0; i < 12; i++) {
      recordJob({ name: `ws${i}` }, { name: "build" });
    }

    expect(recentJobs.value.length).toBe(10);
    // 直近に記録した分が残り、最初期の分は切り捨てられる
    expect(recentJobs.value.map((j) => j.key)).toContain("ws11:build");
    expect(recentJobs.value.map((j) => j.key)).not.toContain("ws0:build");
  });
});

describe("useRecentJobs: 旧キー jobDetachedTab の正規化（v4 リネーム過渡期）", () => {
  it("localStorage キャッシュの jobDetachedTab は読み込み時に jobDetached へ正規化される", async () => {
    localStorage.setItem(
      "any_console_recent_jobs",
      JSON.stringify([job("ws1:dev", { jobDetachedTab: true })]),
    );
    // サーバー要求が未解決の間（= キャッシュ表示中）の起動経路を模す
    apiGetMock.mockReturnValue(new Promise(() => {}));
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    loadRecentJobs();

    const item = recentJobs.value.find((j) => j.key === "ws1:dev");
    expect(item.jobDetached).toBe(true);
    expect("jobDetachedTab" in item).toBe(false);
  });

  it("サーバー応答に旧キーが残っていても正規化される（旧バックエンド互換）", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { recent_jobs: [job("ws2:run", { jobDetachedTab: true })] },
    });
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    await loadRecentJobs();

    const item = recentJobs.value.find((j) => j.key === "ws2:run");
    expect(item.jobDetached).toBe(true);
    expect("jobDetachedTab" in item).toBe(false);
  });

  it("両キー併存（GET ミラー応答）は新キーを正とし legacy キーを落とす", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { recent_jobs: [job("ws3:x", { jobDetached: false, jobDetachedTab: true })] },
    });
    const { useRecentJobs } = await freshModule();
    const { recentJobs, loadRecentJobs } = useRecentJobs();
    await loadRecentJobs();

    const item = recentJobs.value.find((j) => j.key === "ws3:x");
    expect(item.jobDetached).toBe(false);
    expect("jobDetachedTab" in item).toBe(false);
  });
});
