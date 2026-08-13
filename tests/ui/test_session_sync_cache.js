import { describe, it, expect } from "vitest";
import { buildSessionTabParamsWithCache, rememberJobIcon } from "../../ui/composables/useSessionSync.ts";

describe("buildSessionTabParamsWithCache", () => {
  it("ジョブ定義が解決できた場合はそのアイコンを使い、キャッシュへ書き込む", () => {
    const session = { session_id: "s1", job_name: "build", workspace: "ws1" };
    const allJobs = { ws1: { build: { icon: "mdi-hammer", icon_color: "#fff" } } };
    const built = buildSessionTabParamsWithCache(session, { workspaces: [], allJobs });
    expect(built.icon).toBe("mdi-hammer");
  });

  it("再構築時に allJobs が一時的に不完全でも、一度解決済みのアイコンをキャッシュから使う", () => {
    const session = { session_id: "s2", job_name: "deploy", workspace: "ws1" };
    const resolvedAllJobs = { ws1: { deploy: { icon: "mdi-rocket", icon_color: null } } };
    buildSessionTabParamsWithCache(session, { workspaces: [], allJobs: resolvedAllJobs });

    const staleBuilt = buildSessionTabParamsWithCache(session, { workspaces: [], allJobs: {} });
    expect(staleBuilt.icon).toBe("mdi-rocket");
  });

  it("rememberJobIcon で事前に登録したアイコンも、未解決時のフォールバックに使われる", () => {
    const session = { session_id: "s3", job_name: "lint", workspace: "ws1" };
    rememberJobIcon("s3", "mdi-check", "#0f0");
    const built = buildSessionTabParamsWithCache(session, { workspaces: [], allJobs: {} });
    expect(built.icon).toBe("mdi-check");
    expect(built.iconColor).toBe("#0f0");
  });

  it("job_name が無いセッションはキャッシュの影響を受けない", () => {
    const session = { session_id: "s4", job_name: null, workspace: null };
    const built = buildSessionTabParamsWithCache(session, { workspaces: [], allJobs: {} });
    expect(built.icon).toBe("mdi-console");
  });
});
