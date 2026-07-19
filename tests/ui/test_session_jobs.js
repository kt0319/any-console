import { describe, it, expect } from "vitest";
import { buildSessionTabParams, buildTabMeta, tabMetaEquals, stalePendingCloseIds } from "../../ui/utils/session-jobs.js";

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

  it("ワークスペース未登録なら session.icon にフォールバック", () => {
    const p = buildSessionTabParams({ ...session, icon: "mdi-star" }, { workspaces: [], allJobs: {} });
    expect(p.wsIcon).toBe("mdi-star");
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

describe("buildTabMeta", () => {
  it("ワークスペースセッションのメタを正規化する", () => {
    const meta = buildTabMeta({
      workspace: "any-console",
      wsIcon: "mdi-briefcase", wsIconColor: "#f00",
      icon: "mdi-console", iconColor: null,
      jobName: null, jobLabel: null,
    });
    expect(meta).toEqual({
      workspace: "any-console",
      label: "any-console",
      wsIcon: { name: "mdi-briefcase", color: "#f00" },
      icon: { name: "mdi-console", color: null },
      jobName: null,
      jobLabel: null,
    });
  });

  it("ジョブラベルがあればラベルに優先する", () => {
    const meta = buildTabMeta({ workspace: "ws", jobName: "job_1", jobLabel: "claude" });
    expect(meta.label).toBe("claude");
  });

  it("workspace もジョブも無ければ terminal ラベル", () => {
    const meta = buildTabMeta({});
    expect(meta.label).toBe("terminal");
    expect(meta.workspace).toBe(null);
    expect(meta.wsIcon).toBe(null);
  });
});

describe("tabMetaEquals", () => {
  const base = () => buildTabMeta({
    workspace: "ws",
    wsIcon: "mdi-briefcase", wsIconColor: "#f00",
    icon: "mdi-console",
  });

  it("同一内容なら true（アイコンはオブジェクト比較でなく内容比較）", () => {
    expect(tabMetaEquals(base(), base())).toBe(true);
  });

  it("workspace が違えば false", () => {
    expect(tabMetaEquals(base(), { ...base(), workspace: "other", label: "other" })).toBe(false);
  });

  it("アイコンの色違いを検知する", () => {
    const changed = base();
    changed.wsIcon = { name: "mdi-briefcase", color: "#0f0" };
    expect(tabMetaEquals(base(), changed)).toBe(false);
  });

  it("アイコン null ↔ 非 null を検知する", () => {
    const changed = base();
    changed.icon = null;
    expect(tabMetaEquals(base(), changed)).toBe(false);
  });
});

describe("stalePendingCloseIds", () => {
  it("サーバ一覧に無い pendingClose id を返す", () => {
    const pending = new Set(["s1", "s2"]);
    const server = new Set(["s2", "s3"]);
    expect(stalePendingCloseIds(pending, server)).toEqual(["s1"]);
  });

  it("全てサーバに残っていれば空", () => {
    const pending = new Set(["s1"]);
    const server = new Set(["s1", "s2"]);
    expect(stalePendingCloseIds(pending, server)).toEqual([]);
  });

  it("pendingClose が空・null でも落ちない", () => {
    expect(stalePendingCloseIds(new Set(), new Set(["s1"]))).toEqual([]);
    expect(stalePendingCloseIds(null, new Set())).toEqual([]);
  });
});
