import { workspaceFileContentPath } from "./endpoints.ts";
import { GIT_DIFF_STATUS_CLASSES } from "./constants.ts";

export type GitRef = {
  label: string;
  type: "head" | "tag" | "remote" | "branch";
  icon: string;
  synced?: boolean;
};

export function parseGitRefs(refsStr: string | null | undefined): GitRef[] {
  if (!refsStr) return [];
  const parsed: GitRef[] = refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r): GitRef => {
      if (r.startsWith("HEAD -> ")) {
        return { label: r.replace("HEAD -> ", ""), type: "head", icon: "mdi-source-branch" };
      }
      if (r.startsWith("tag: ")) {
        return { label: r.replace("tag: ", ""), type: "tag", icon: "mdi-tag-outline" };
      }
      if (r.startsWith("origin/")) {
        return { label: r, type: "remote", icon: "mdi-github" };
      }
      if (r.startsWith("upstream/")) {
        return { label: r, type: "remote", icon: "mdi-server" };
      }
      return { label: r, type: "branch", icon: "mdi-source-branch" };
    });
  const localBranches = parsed.filter(r => r.type === "head" || r.type === "branch");
  for (const local of localBranches) {
    const remoteIdx = parsed.findIndex(
      r => r.type === "remote" && r.label === "origin/" + local.label
    );
    if (remoteIdx !== -1) {
      local.synced = true;
      parsed.splice(remoteIdx, 1);
    }
  }
  return parsed;
}

/**
 * コミットメッセージの1行目（サマリ行）。ツールチップやpeekピル等の
 * 1行表示に使う。
 */
export function firstCommitLine(message: string | null | undefined): string {
  return String(message || "").split("\n")[0].trim();
}

export function formatGitTime(timeText: string | null | undefined): string {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return timeText;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

export function parseDiffNumstatFromChunk(diffChunk: string | null | undefined): { insertions: number, deletions: number } | null {
  if (!diffChunk) return null;
  let insertions = 0;
  let deletions = 0;
  let changed = false;
  for (const line of diffChunk.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      insertions += 1;
      changed = true;
    } else if (line.startsWith("-")) {
      deletions += 1;
      changed = true;
    }
  }
  if (!changed) return null;
  return { insertions, deletions };
}

export function buildNumstatHtml(insertions: number | null | undefined, deletions: number | null | undefined, opts: { omitZeroDeletions?: boolean; neutralText?: boolean } = {}) {
  if (insertions == null && deletions == null) return "";
  const { omitZeroDeletions = false, neutralText = false } = opts;
  const addValue = insertions == null ? 0 : insertions;
  const delValue = deletions == null ? 0 : deletions;
  const addClass = neutralText ? "numstat-neutral" : "numstat-added";
  const delClass = neutralText ? "numstat-neutral" : "numstat-deleted";
  if (omitZeroDeletions && delValue === 0) {
    return `<span class="${addClass}">+${addValue}</span>`;
  }
  return `<span class="${addClass}">+${addValue}</span> <span class="${delClass}">-${delValue}</span>`;
}

export function countContentLines(content: string | null | undefined): number {
  const text = String(content || "");
  if (!text) return 0;
  const lines = text.split("\n").length;
  if (text.endsWith("\n")) return Math.max(0, lines - 1);
  return lines;
}

type GitFileLike = {
  status?: string;
  path?: string;
  name?: string;
  insertions?: number | null;
  deletions?: number | null;
  added?: number | null;
  deleted?: number | null;
};

export function buildFileNumstatHtml(file: GitFileLike, diffChunk = "", opts: { neutralText?: boolean } = {}) {
  const status = String(file.status || "").trim();
  const omitZeroDeletions = status === "??" || status === "A";
  const { neutralText = false } = opts;
  const insertions = file.insertions ?? file.added;
  const deletions = file.deletions ?? file.deleted;
  if (insertions != null || deletions != null) {
    return buildNumstatHtml(insertions, deletions, { omitZeroDeletions, neutralText });
  }
  const parsed = parseDiffNumstatFromChunk(diffChunk);
  return buildNumstatHtml(parsed?.insertions, parsed?.deletions, { omitZeroDeletions, neutralText });
}

export async function resolveUntrackedNumstat({ workspace, files, apiFetch }: {
  workspace: string | null | undefined,
  files: GitFileLike[] | null | undefined,
  apiFetch: (url: string) => Promise<Response | null | undefined>,
}): Promise<Record<string, number>> {
  const pathToLines: Record<string, number> = {};
  if (!workspace || !Array.isArray(files) || files.length === 0) return pathToLines;

  const tasks = files
    .filter((file) => {
      const status = String(file.status || "").trim();
      const hasNumstat = file.insertions != null || file.deletions != null;
      return (status === "??" || status === "A") && !hasNumstat && (file.path || file.name);
    })
    .map(async (file) => {
      // 上のfilterで file.path || file.name が truthy であることを保証済み。
      const path = (file.path || file.name) as string;
      const res = await apiFetch(workspaceFileContentPath(workspace, path));
      if (!res || !res.ok) return;
      const data = await res.json();
      if (typeof data?.content !== "string") return;
      pathToLines[path] = countContentLines(data.content);
    });
  await Promise.allSettled(tasks);

  return pathToLines;
}

export function entryBranches(entry: { refs?: GitRef[] }): string[] {
  return (entry.refs || [])
    .filter((r) => r.type === "branch" || r.type === "remote")
    .map((r) => r.label);
}

/**
 * GitHub のファイル/ディレクトリ URL を組み立てる（GitHub リンク生成の単一実装）。
 */
export function buildGitHubFileUrl(githubUrl: string, ref: string, path: string, type: "blob" | "tree" = "blob") {
  if (!githubUrl || !ref) return "";
  return `${githubUrl}/${type}/${ref}/${path}`;
}

/** 差分ステータス文字（M / A / D / ?）を表示用クラスへ写像する（未知は空文字）。 */
export function diffStatusClass(status: string): string {
  return GIT_DIFF_STATUS_CLASSES[status as keyof typeof GIT_DIFF_STATUS_CLASSES] || "";
}

export function abbreviateBranch(branch: string): { abbr: string, rest: string } {
  const slash = branch.indexOf("/");
  if (slash === -1) return { abbr: "", rest: branch };
  return { abbr: branch[0] + "~/", rest: branch.slice(slash + 1) };
}

export function truncateHead(str: string, maxLen = 14): string {
  if (str.length <= maxLen) return str;
  return "…" + str.slice(str.length - (maxLen - 1));
}

export function dirtyBadgeHtml(ws: { changed_files?: number, insertions?: number, deletions?: number } | null | undefined): string {
  const files = ws?.changed_files || 0;
  const ins = ws?.insertions || 0;
  const del = ws?.deletions || 0;
  const filePart = files > 0 ? `<span class="header-git-files">${files}F</span> ` : "";
  return `${filePart}<span class="diff-num-plus">+${ins}</span> <span class="diff-num-del">-${del}</span>`;
}
