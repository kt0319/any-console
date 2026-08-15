// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalStore } from "../../ui/stores/terminal.ts";
import { on } from "../../ui/app-bridge.ts";

const apiGetMock = vi.fn();
const apiDeleteMock = vi.fn(async () => ({ ok: true }));
const apiPostMock = vi.fn(async () => ({ ok: true }));

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock, apiDelete: apiDeleteMock, apiPost: apiPostMock }),
}));

// 動的importにする（vi.mockのホイスティングでuseApiモックが先に効くようにするため）。
const { useWorktreeCleanup } = await import("../../ui/composables/useWorktreeCleanup.ts");

describe("useWorktreeCleanup", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiGetMock.mockReset();
    apiDeleteMock.mockClear();
    apiPostMock.mockClear();
  });

  describe("findResidue", () => {
    it("開いているタブ・detachedセッション・dev serverを対象workspace名でまとめて見つける", async () => {
      const terminalStore = useTerminalStore();
      terminalStore.openTabs = [
        { id: 1, sessionId: "s1", workspace: "app:feat/x" },
        { id: 2, sessionId: "s2", workspace: "other" },
      ];
      apiGetMock.mockImplementation(async (ep) => {
        if (ep === "/terminal/sessions") {
          return {
            ok: true,
            data: [
              { session_id: "s1", workspace: "app:feat/x" }, // 既に開いているタブ側なので対象外
              { session_id: "s3", workspace: "app:feat/x" }, // detached（タブに無い）
              { session_id: "s4", workspace: "other" },
            ],
          };
        }
        if (ep === "/preview/ports") {
          return {
            ok: true,
            data: [
              { pid: 111, port: 3000, workspace: "app:feat/x" },
              { pid: 222, port: 4000, workspace: "other" },
              { pid: null, port: 5000, workspace: "app:feat/x" }, // pid無しは対象外
            ],
          };
        }
        return { ok: false, data: null };
      });

      const { findResidue } = useWorktreeCleanup();
      const residue = await findResidue(undefined, "app:feat/x");

      expect(residue.openTabs.map((t) => t.sessionId)).toEqual(["s1"]);
      expect(residue.detachedSessions.map((s) => s.session_id)).toEqual(["s3"]);
      expect(residue.devServers.map((p) => p.pid)).toEqual([111]);
    });

    it("workspace名が無ければ空のまま（API呼び出しもしない）", async () => {
      const { findResidue } = useWorktreeCleanup();
      const residue = await findResidue({});
      expect(residue).toEqual({ openTabs: [], detachedSessions: [], devServers: [] });
      expect(apiGetMock).not.toHaveBeenCalled();
    });

    it("wt.workspace/wt.nameが優先されwsWorkspaceName引数は無くても解決できる", async () => {
      apiGetMock.mockResolvedValue({ ok: true, data: [] });
      const { findResidue } = useWorktreeCleanup();
      await findResidue({ name: "app-feature-x" });
      expect(apiGetMock).toHaveBeenCalledWith("/terminal/sessions");
    });

    it("wt.branchが分かる時はworktree_base/worktree_branchで比較する（workspace文字列が完全一致しなくても見つかる）", async () => {
      // dev serverのworkspaceはcwdから都度推測されるため、bracket形式の完全一致に
      // ならないことがある（server/src/preview.rsのmatch_workspace参照）。
      // worktree_base/worktree_branchが一致していれば拾えることを確認する。
      apiGetMock.mockImplementation(async (ep) => {
        if (ep === "/terminal/sessions") {
          return {
            ok: true,
            data: [
              { session_id: "s3", workspace: "app", worktree_base: "app", worktree_branch: "feat/x" },
              { session_id: "s4", workspace: "other", worktree_base: "other", worktree_branch: "feat/y" },
            ],
          };
        }
        if (ep === "/preview/ports") {
          return {
            ok: true,
            data: [
              { pid: 111, port: 3000, workspace: "app", worktree_base: "app", worktree_branch: "feat/x" },
              { pid: 222, port: 4000, workspace: "app", worktree_base: "app", worktree_branch: "feat/y" },
            ],
          };
        }
        return { ok: false, data: null };
      });

      const { findResidue } = useWorktreeCleanup();
      const residue = await findResidue({ workspace: "app:feat/x", branch: "feat/x" });

      expect(residue.detachedSessions.map((s) => s.session_id)).toEqual(["s3"]);
      expect(residue.devServers.map((p) => p.pid)).toEqual([111]);
    });

    it("worktree_branchが無い対象（worktreeでない）は従来通りworkspace完全一致で比較する", async () => {
      apiGetMock.mockImplementation(async (ep) => {
        if (ep === "/terminal/sessions") {
          return { ok: true, data: [{ session_id: "s3", workspace: "app", worktree_base: "app", worktree_branch: "feat/x" }] };
        }
        if (ep === "/preview/ports") {
          return { ok: true, data: [] };
        }
        return { ok: false, data: null };
      });

      const { findResidue } = useWorktreeCleanup();
      const residue = await findResidue(undefined, "app");
      // worktree_base一致だけでは拾わない（branchが無いのでworkspace完全一致が必要）
      expect(residue.detachedSessions).toEqual([{ session_id: "s3", workspace: "app", worktree_base: "app", worktree_branch: "feat/x" }]);
    });
  });

  describe("cleanupResidue", () => {
    it("開いているタブはtab:closeをemitし、detachedセッションはDELETE、dev serverはkillする", async () => {
      const closed = [];
      const off = on("tab:close", ({ tab }) => closed.push(tab.id));

      const { cleanupResidue } = useWorktreeCleanup();
      await cleanupResidue({
        openTabs: [{ id: 1, sessionId: "s1" }],
        detachedSessions: [{ session_id: "s3" }],
        devServers: [{ pid: 111 }],
      });

      off();
      expect(closed).toEqual([1]);
      expect(apiDeleteMock).toHaveBeenCalledWith("/terminal/sessions/s3");
      expect(apiPostMock).toHaveBeenCalledWith("/system/process/kill", { pid: 111 });
    });

    it("何も無ければAPIを呼ばない", async () => {
      const { cleanupResidue } = useWorktreeCleanup();
      await cleanupResidue({ openTabs: [], detachedSessions: [], devServers: [] });
      expect(apiDeleteMock).not.toHaveBeenCalled();
      expect(apiPostMock).not.toHaveBeenCalled();
    });
  });
});
