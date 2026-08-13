import { useAuthStore } from "../stores/auth.ts";
import { useGitStore, parseDiffChunks } from "../stores/git.ts";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { buildFileNumstatHtml, resolveUntrackedNumstat } from "../utils/git.ts";
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
    return fileList.map((f) => ({
      ...f,
      numstat: buildFileNumstatHtml(
        { ...f, insertions: f.insertions ?? untrackedNumstat[f.path], deletions: f.deletions ?? (untrackedNumstat[f.path] != null ? 0 : f.deletions) },
        diffChunks[f.path],
        { neutralText: untrackedNumstat[f.path] != null && f.insertions == null && f.deletions == null },
      ),
    }));
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
