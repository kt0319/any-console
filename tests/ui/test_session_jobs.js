import { describe, it, expect, vi } from "vitest";
import { needsJobsRefetch, loadAllJobs } from "../../ui/utils/session-jobs.js";

describe("needsJobsRefetch", () => {
  it("空 allJobs + ジョブセッションあり → 再取得する", () => {
    expect(needsJobsRefetch({}, [{ job_name: "job_1" }])).toBe(true);
  });

  it("空 allJobs でもジョブセッションが無ければ再取得しない", () => {
    expect(needsJobsRefetch({}, [{ job_name: null }, { job_name: "" }])).toBe(false);
    expect(needsJobsRefetch({}, [])).toBe(false);
  });

  it("allJobs が既に埋まっていれば再取得しない", () => {
    expect(needsJobsRefetch({ ws: { job_1: {} } }, [{ job_name: "job_1" }])).toBe(false);
  });

  it("null/undefined を安全に扱う", () => {
    expect(needsJobsRefetch(null, [{ job_name: "job_1" }])).toBe(true);
    expect(needsJobsRefetch(undefined, null)).toBe(false);
    expect(needsJobsRefetch({}, null)).toBe(false);
  });
});

describe("loadAllJobs", () => {
  const populated = { ws: { job_1: { icon: "icon:x.png" } } };
  // Response 相当を JSON へ落とす readJson（実装の _safeResJson と同じ挙動）
  const readJson = async (res) => (res && res.ok ? res.body : {});
  const res = (body) => ({ ok: true, body });

  it("初回が空 + ジョブセッションあり → 再取得して回復する", async () => {
    const refetch = vi.fn().mockResolvedValue(res(populated));
    const allJobs = await loadAllJobs(res({}), [{ job_name: "job_1" }], { readJson, refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(allJobs).toEqual(populated);
  });

  it("初回が空でもジョブセッションが無ければ再取得しない", async () => {
    const refetch = vi.fn();
    const allJobs = await loadAllJobs(res({}), [{ job_name: null }], { readJson, refetch });
    expect(refetch).not.toHaveBeenCalled();
    expect(allJobs).toEqual({});
  });

  it("初回で埋まっていれば再取得しない", async () => {
    const refetch = vi.fn();
    const allJobs = await loadAllJobs(res(populated), [{ job_name: "job_1" }], { readJson, refetch });
    expect(refetch).not.toHaveBeenCalled();
    expect(allJobs).toEqual(populated);
  });

  it("再取得も空なら空のまま返す（無限リトライしない）", async () => {
    const refetch = vi.fn().mockResolvedValue(res({}));
    const allJobs = await loadAllJobs(res({}), [{ job_name: "job_1" }], { readJson, refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(allJobs).toEqual({});
  });

  it("先行取得が失敗（null）でも再取得で回復する", async () => {
    const refetch = vi.fn().mockResolvedValue(res(populated));
    const allJobs = await loadAllJobs(null, [{ job_name: "job_1" }], { readJson, refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(allJobs).toEqual(populated);
  });
});
