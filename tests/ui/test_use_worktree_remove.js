// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi } from "vitest";

const apiDeleteMock = vi.fn(async () => ({ ok: true }));

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiDelete: apiDeleteMock,
    wsEndpoint: (ws, path) => `/workspaces/${ws}/${path}`,
  }),
}));

import { useWorktreeRemove } from "../../ui/composables/useWorktreeRemove.ts";
import { on } from "../../ui/app-bridge.ts";

describe("useWorktreeRemove", () => {
  it("成功時にベースワークスペース宛てのpeekイベントを流す", async () => {
    apiDeleteMock.mockResolvedValueOnce({ ok: true });
    const events = [];
    const off = on("git:remoteDone", (d) => events.push(d));

    const ok = await useWorktreeRemove().removeWorktreeRequest("repo", { path: "/p", worktree_branch: "feature/x" });

    expect(ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].wsName).toBe("repo");
    expect(events[0].result).toMatchObject({ kind: "none", headline: "Worktree removed" });
    expect(events[0].result.detail).toContain("feature/x");
    off();
  });

  it("失敗時はイベントを流さない", async () => {
    apiDeleteMock.mockResolvedValueOnce({ ok: false });
    const events = [];
    const off = on("git:remoteDone", (d) => events.push(d));

    expect(await useWorktreeRemove().removeWorktreeRequest("repo", { path: "/p" })).toBe(false);
    expect(events).toEqual([]);
    off();
  });
});
