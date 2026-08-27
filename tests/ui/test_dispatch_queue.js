// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { applyDispatchQueue, useDispatchQueue } from "../../ui/composables/useDispatchQueue.ts";
import { emit, on } from "../../ui/app-bridge.ts";

const apiPostMock = vi.fn();
const apiGetMock = vi.fn(async () => ({ ok: false }));

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock, apiPost: apiPostMock }),
}));

const item = (id) => ({ id, request: { workspace: "ws1" } });
const recentItem = (id, outcome) => ({ id, request: { workspace: "ws1" }, outcome });

describe("applyDispatchQueue", () => {
  let queue, recent;

  beforeEach(() => {
    setActivePinia(createPinia());
    ({ queue, recent } = useDispatchQueue());
    applyDispatchQueue([]);
  });

  it("スナップショット全量でキューを置き換える", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    expect(queue.value.map((q) => q.id)).toEqual(["d1", "d2"]);

    applyDispatchQueue([item("d3")]);
    expect(queue.value.map((q) => q.id)).toEqual(["d3"]);
  });

  it("空スナップショットで残存項目をすべて消す", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([]);
    expect(queue.value).toEqual([]);
  });

  it("消えた項目のIDだけ dispatch:itemRemoved で通知する（他端末で決定済み）", () => {
    const removedIds = [];
    const off = on("dispatch:itemRemoved", ({ id }) => removedIds.push(id));

    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([item("d1")]); // d2 だけ消える
    expect(removedIds).toEqual(["d2"]);

    off();
  });

  it("残っている項目は通知しない", () => {
    const removedIds = [];
    const off = on("dispatch:itemRemoved", ({ id }) => removedIds.push(id));

    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([item("d1"), item("d2")]);
    expect(removedIds).toEqual([]);

    off();
  });

  it("recentItems をそのまま recent に反映する", () => {
    applyDispatchQueue([], [recentItem("r1", "executed"), recentItem("r2", "discarded")]);
    expect(recent.value.map((r) => [r.id, r.outcome])).toEqual([
      ["r1", "executed"],
      ["r2", "discarded"],
    ]);
  });

  it("recentItems省略時は recent を空にする", () => {
    applyDispatchQueue([], [recentItem("r1", "executed")]);
    applyDispatchQueue([]);
    expect(recent.value).toEqual([]);
  });
});

describe("runItem", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiPostMock.mockReset();
  });

  // pendingのitemでも、既に決定済みで履歴に残っているだけのitemでも同じ
  // decision APIを叩く（サーバ側 dispatch_execute が dispatch_id の所在を
  // 見て振り分けるため、フロント側でpending/recentを区別する必要が無い）。
  it("executed:trueと上書き値を付けてdecision APIを呼び、成功でtrueを返す", async () => {
    apiPostMock.mockResolvedValue({ ok: true, data: {} });
    const { runItem } = useDispatchQueue();
    const ok = await runItem("d1", { text: "echo edited" });
    expect(ok).toBe(true);
    expect(apiPostMock).toHaveBeenCalledWith(
      "/dispatch/d1/decision",
      { executed: true, text: "echo edited" },
      expect.anything(),
    );
  });

  it("失敗時はfalseを返す", async () => {
    apiPostMock.mockResolvedValue({ ok: false, data: null });
    const { runItem } = useDispatchQueue();
    expect(await runItem("d1", {})).toBe(false);
  });
});

describe("jobLabel / allJobs（/jobs/workspacesからのジョブ表示名解決）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // allJobsはモジュールスコープでキャッシュされる（queue/recentと同じ設計）ため、
    // 前のテストで読み込み済みだと再フェッチされない。jobs:refreshで強制的に
    // キャッシュを無効化し、このdescribeの各テストが必ず自前でfetchするようにする。
    emit("jobs:refresh");
    apiGetMock.mockReset();
  });

  it("allJobsが読み込まれるまではjobLabelは空文字", async () => {
    let resolveGet;
    apiGetMock.mockReturnValue(new Promise((r) => { resolveGet = r; }));
    const { jobLabel } = useDispatchQueue();
    expect(jobLabel({ workspace: "ws1", job: "job_1" })).toBe("");
    resolveGet({ ok: true, data: {} });
  });

  it("読み込み後はallJobsからlabelを解決する", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { ws1: { job_1: { label: "Claude Worker" } } },
    });
    const { jobLabel } = useDispatchQueue();
    await vi.waitFor(() => {
      expect(jobLabel({ workspace: "ws1", job: "job_1" })).toBe("Claude Worker");
    });
  });

  it("labelが引けない・既定ジョブは空文字", async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { ws1: { job_1: { label: "Claude Worker" } } },
    });
    const { jobLabel, allJobs } = useDispatchQueue();
    await vi.waitFor(() => expect(Object.keys(allJobs.value)).toContain("ws1"));
    expect(jobLabel({ workspace: "ws1", job: "unknown_job" })).toBe("");
    expect(jobLabel({ workspace: "ws1", job: "terminal" })).toBe("");
    expect(jobLabel({ workspace: "other-ws", job: "job_1" })).toBe("");
  });
});
