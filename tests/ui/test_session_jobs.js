import { describe, it, expect, vi } from "vitest";
import { needsJobsRefetch, loadAllJobs, loadSessionsResponse, buildSessionTabParams, applyCachedJobIcon, isJobDefResolved } from "../../ui/utils/session-jobs.ts";

describe("needsJobsRefetch", () => {
  it("空 allJobs + ジョブセッションあり → 再取得する", () => {
    expect(needsJobsRefetch({}, [{ job_name: "job_1", workspace: "ws" }])).toBe(true);
  });

  it("空 allJobs でもジョブセッションが無ければ再取得しない", () => {
    expect(needsJobsRefetch({}, [{ job_name: null, workspace: "ws" }, { job_name: "", workspace: "ws" }])).toBe(false);
    expect(needsJobsRefetch({}, [])).toBe(false);
  });

  it("allJobs が既に埋まっていれば再取得しない", () => {
    expect(needsJobsRefetch({ ws: { job_1: {} } }, [{ job_name: "job_1", workspace: "ws" }])).toBe(false);
  });

  it("他ワークスペース分は届いているが、対象ワークスペースだけ空なら再取得する", () => {
    expect(needsJobsRefetch({ other: { job_1: {} } }, [{ job_name: "job_1", workspace: "ws" }])).toBe(true);
  });

  it("null/undefined を安全に扱う", () => {
    expect(needsJobsRefetch(null, [{ job_name: "job_1", workspace: "ws" }])).toBe(true);
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
    const allJobs = await loadAllJobs(res({}), [{ job_name: "job_1", workspace: "ws" }], { readJson, refetch });
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
    const allJobs = await loadAllJobs(res(populated), [{ job_name: "job_1", workspace: "ws" }], { readJson, refetch });
    expect(refetch).not.toHaveBeenCalled();
    expect(allJobs).toEqual(populated);
  });

  it("再取得も空なら空のまま返す（無限リトライしない）", async () => {
    const refetch = vi.fn().mockResolvedValue(res({}));
    const allJobs = await loadAllJobs(res({}), [{ job_name: "job_1", workspace: "ws" }], { readJson, refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(allJobs).toEqual({});
  });

  it("先行取得が失敗（null）でも再取得で回復する", async () => {
    const refetch = vi.fn().mockResolvedValue(res(populated));
    const allJobs = await loadAllJobs(null, [{ job_name: "job_1", workspace: "ws" }], { readJson, refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(allJobs).toEqual(populated);
  });
});

describe("loadSessionsResponse", () => {
  const ok = { ok: true };
  const fail = { ok: false };

  it("初回が ok ならそのまま返し再取得しない", async () => {
    const refetch = vi.fn();
    const out = await loadSessionsResponse(ok, { refetch });
    expect(refetch).not.toHaveBeenCalled();
    expect(out).toBe(ok);
  });

  it("初回が失敗(!ok)なら再取得したレスポンスを返す", async () => {
    const retry = { ok: true };
    const refetch = vi.fn().mockResolvedValue(retry);
    const out = await loadSessionsResponse(fail, { refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(out).toBe(retry);
  });

  it("初回が null なら再取得する", async () => {
    const retry = { ok: true };
    const refetch = vi.fn().mockResolvedValue(retry);
    const out = await loadSessionsResponse(null, { refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(out).toBe(retry);
  });

  it("再取得も失敗ならその失敗レスポンスを返す（無限リトライしない）", async () => {
    const retry = { ok: false };
    const refetch = vi.fn().mockResolvedValue(retry);
    const out = await loadSessionsResponse(null, { refetch });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(out).toBe(retry);
  });
});

describe("buildSessionTabParams", () => {
  const session = {
    ws_url: "/terminal/ws/ac-x",
    workspace: "any-console",
    icon: null,
    icon_color: null,
    job_name: "job_1",
    job_label: "claude",
  };
  const workspaces = [{ name: "any-console", icon: "mdi-briefcase", icon_color: "#f00" }];
  const allJobs = { "any-console": { job_1: { icon: "icon:x.png", icon_color: "#0f0" } } };

  it("wsIcon をワークスペース設定から解決する（session.icon が空でも出る）", () => {
    const p = buildSessionTabParams(session, { workspaces, allJobs });
    expect(p.wsIcon).toBe("mdi-briefcase");
    expect(p.wsIconColor).toBe("#f00");
  });

  it("ジョブアイコンをジョブ定義から解決する", () => {
    const p = buildSessionTabParams(session, { workspaces, allJobs });
    expect(p.icon).toBe("icon:x.png");
    expect(p.iconColor).toBe("#0f0");
    expect(p.jobName).toBe("job_1");
    expect(p.jobLabel).toBe("claude");
  });

  it("ワークスペース未登録ならwsIconはnull（job側のsession.iconへはフォールバックしない）", () => {
    const p = buildSessionTabParams({ ...session, icon: "mdi-star" }, { workspaces: [], allJobs: {} });
    expect(p.wsIcon).toBe(null);
  });

  it("ジョブ定義が無ければ mdi-play にフォールバック", () => {
    const p = buildSessionTabParams(session, { workspaces, allJobs: {} });
    expect(p.icon).toBe("mdi-play");
  });

  it("ジョブでない（job_name なし）なら mdi-console", () => {
    const p = buildSessionTabParams({ ...session, job_name: null }, { workspaces, allJobs });
    expect(p.icon).toBe("mdi-console");
    expect(p.jobName).toBe(null);
  });

  it("ctx 省略でも落ちない", () => {
    const p = buildSessionTabParams(session);
    expect(p.icon).toBe("mdi-play");
    expect(p.wsIcon).toBe(null);
  });
});

describe("isJobDefResolved", () => {
  it("job_name が無ければ常に解決済み扱い", () => {
    expect(isJobDefResolved({ job_name: null }, {})).toBe(true);
  });

  it("allJobs にジョブ定義があれば解決済み", () => {
    const allJobs = { ws: { job_1: { icon: "mdi-play" } } };
    expect(isJobDefResolved({ job_name: "job_1", workspace: "ws" }, allJobs)).toBe(true);
  });

  it("ワークスペース/ジョブが allJobs に無ければ未解決", () => {
    expect(isJobDefResolved({ job_name: "job_1", workspace: "ws" }, {})).toBe(false);
    expect(isJobDefResolved({ job_name: "job_1", workspace: "ws" }, { ws: {} })).toBe(false);
  });
});

describe("applyCachedJobIcon", () => {
  const session = { session_id: "sess_1", job_name: "job_1" };

  it("解決に成功したらキャッシュへ記録する", () => {
    const cache = new Map();
    const built = { icon: "icon:x.png", iconColor: "#0f0" };
    const result = applyCachedJobIcon(built, true, session, cache);
    expect(result).toEqual(built);
    expect(cache.get("sess_1")).toEqual({ icon: "icon:x.png", iconColor: "#0f0" });
  });

  it("未解決時、キャッシュ済みの値があれば上書きしない", () => {
    const cache = new Map([["sess_1", { icon: "icon:x.png", iconColor: "#0f0" }]]);
    const built = { icon: "mdi-play", iconColor: null };
    const result = applyCachedJobIcon(built, false, session, cache);
    expect(result.icon).toBe("icon:x.png");
    expect(result.iconColor).toBe("#0f0");
  });

  it("未解決時、キャッシュが無ければそのまま（かつ記録する）", () => {
    const cache = new Map();
    const built = { icon: "mdi-play", iconColor: null };
    const result = applyCachedJobIcon(built, false, session, cache);
    expect(result.icon).toBe("mdi-play");
    expect(cache.get("sess_1")).toEqual({ icon: "mdi-play", iconColor: null });
  });

  it("解決済みでアイコンが既定値(mdi-play)なだけの場合はキャッシュで上書きしない（新規登録する）", () => {
    // ジョブのアイコンが削除・既定に戻された等でジョブ定義自体は見つかっているのに
    // アイコン文字列だけを見て「未解決」と誤判定すると、古いキャッシュ値が復活してしまう。
    const cache = new Map([["sess_1", { icon: "icon:x.png", iconColor: "#0f0" }]]);
    const built = { icon: "mdi-play", iconColor: null };
    const result = applyCachedJobIcon(built, true, session, cache);
    expect(result.icon).toBe("mdi-play");
    expect(cache.get("sess_1")).toEqual({ icon: "mdi-play", iconColor: null });
  });

  it("job_name が無ければキャッシュに触れない", () => {
    const cache = new Map();
    const built = { icon: "mdi-console", iconColor: null };
    const result = applyCachedJobIcon(built, true, { session_id: "sess_2", job_name: null }, cache);
    expect(result).toBe(built);
    expect(cache.size).toBe(0);
  });
});
