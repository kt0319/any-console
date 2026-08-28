import { useAuthStore } from "../stores/auth.ts";
import { useGitStore, parseDiffChunks } from "../stores/git.ts";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { buildFileNumstatHtml, resolveFileNumstat, resolveUntrackedNumstat } from "../utils/git.ts";
import { workspaceCommitDiffPath } from "../utils/endpoints.ts";

export function buildFileList(files: Record<string, any>[] | null | undefined) {
  return (files || []).map((f) => ({
    path: f.path || f.name,
    status: f.status || "M",
    insertions: f.insertions,
    deletions: f.deletions,
  }));
}

export function useGitDiff() {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const gitStore = useGitStore();
  const { apiGet, wsEndpoint } = useApi();

  function storeDiffResult(diffChunks: Record<string, string>, diffText: string, fileList: ReturnType<typeof buildFileList>) {
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = diffText;
    gitStore.diffFileStatuses = Object.fromEntries(fileList.map((f) => [f.path, f.status]));
  }

  function attachNumstat(fileList: ReturnType<typeof buildFileList>, diffChunks: Record<string, string>, untrackedNumstat: Record<string, number> = {}) {
    return fileList.map((f) => {
      const merged = { ...f, insertions: f.insertions ?? untrackedNumstat[f.path], deletions: f.deletions ?? (untrackedNumstat[f.path] != null ? 0 : f.deletions) };
      const resolved = resolveFileNumstat(merged, diffChunks[f.path]);
      return {
        ...f,
        // 生のf.insertions/deletions（trackedファイルのみ・untracked等はnull）を
        // 表示可能な確定値（無情報時は0）に置き換える。合計numstat
        // （GitChanges.vue）がper-fileと同じ解決順（tracked → untracked行数 →
        // diffChunk解析）を個々にたどり直さず単純合計できるようにするため。
        insertions: resolved.insertions ?? 0,
        deletions: resolved.deletions ?? 0,
        numstat: buildFileNumstatHtml(merged, diffChunks[f.path], {
          neutralText: untrackedNumstat[f.path] != null && f.insertions == null && f.deletions == null,
        }),
      };
    });
  }

  async function fetchWorkingTreeDiff() {
    return await withWorkspace(async (workspace) => {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "diff"));
      if (!ok) return null;
      const fileList = buildFileList(data.files);
      const untrackedNumstat = await resolveUntrackedNumstat({
        workspace,
        files: fileList,
        apiFetch: auth.apiFetch.bind(auth),
      });
      const diffChunks = parseDiffChunks(data.diff);
      storeDiffResult(diffChunks, data.diff || "", fileList);
      return { fileList: attachNumstat(fileList, diffChunks, untrackedNumstat), diffChunks, untrackedNumstat };
    }) ?? null;
  }

  async function fetchCommitDiff(hash: string) {
    return await withWorkspace(async (workspace) => {
      const { ok, data } = await apiGet(workspaceCommitDiffPath(workspace, hash));
      if (!ok) return null;
      const diffChunks = parseDiffChunks(data.diff);
      const fileList = buildFileList(data.files);
      storeDiffResult(diffChunks, data.diff || "", fileList);
      return { fileList: attachNumstat(fileList, diffChunks), diffChunks };
    }) ?? null;
  }

  return { fetchWorkingTreeDiff, fetchCommitDiff };
}
