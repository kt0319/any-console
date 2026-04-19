import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore, parseDiffChunks } from "../stores/git.js";
import { useApi } from "./useApi.js";
import { buildFileNumstatHtml, resolveUntrackedNumstat } from "../utils/git.js";

export function buildFileList(files) {
  return (files || []).map((f) => ({
    path: f.path || f.name,
    status: f.status || "M",
    insertions: f.insertions,
    deletions: f.deletions,
  }));
}

export function useGitDiff() {
  const auth = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const gitStore = useGitStore();
  const { apiGet, wsEndpoint } = useApi();

  function storeDiffResult(diffChunks, diffText, fileList) {
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = diffText;
    gitStore.diffFileStatuses = Object.fromEntries(fileList.map((f) => [f.path, f.status]));
  }

  async function fetchWorkingTreeDiff() {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return null;
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
    const filesWithNumstat = fileList.map((f) => ({
      path: f.path,
      status: f.status,
      numstat: buildFileNumstatHtml(
        { ...f, insertions: f.insertions ?? untrackedNumstat[f.path], deletions: f.deletions ?? (untrackedNumstat[f.path] != null ? 0 : f.deletions) },
        diffChunks[f.path],
        { neutralText: untrackedNumstat[f.path] != null && f.insertions == null && f.deletions == null },
      ),
    }));
    return { fileList: filesWithNumstat, diffChunks, untrackedNumstat };
  }

  async function fetchCommitDiff(hash) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return null;
    const { ok, data } = await apiGet(wsEndpoint(workspace, `diff/${encodeURIComponent(hash)}`));
    if (!ok) return null;
    const diffChunks = parseDiffChunks(data.diff);
    const fileList = buildFileList(data.files);
    storeDiffResult(diffChunks, data.diff || "", fileList);
    const filesWithNumstat = fileList.map((f) => ({
      ...f,
      numstat: buildFileNumstatHtml(f, diffChunks[f.path]),
    }));
    return { fileList: filesWithNumstat, diffChunks };
  }

  return { fetchWorkingTreeDiff, fetchCommitDiff };
}
