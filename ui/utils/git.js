export function parseGitRefs(refsStr) {
  if (!refsStr) return [];
  const parsed = refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r) => {
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

export function formatGitTime(timeText) {
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

export function parseGitLogEntries(stdout) {
  if (!stdout) return [];
  const lines = stdout.trim().split("\n");
  const result = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [hash, time, author, refs, ...msgParts] = parts;
    result.push({
      hash: hash.slice(0, 8),
      fullHash: hash,
      refs: parseGitRefs(refs),
      author,
      time: formatGitTime(time),
      message: msgParts.join("\t"),
    });
  }
  return result;
}

export function parseDiffNumstatFromChunk(diffChunk) {
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

export function buildNumstatHtml(insertions, deletions, opts = {}) {
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

export function countContentLines(content) {
  const text = String(content || "");
  if (!text) return 0;
  const lines = text.split("\n").length;
  if (text.endsWith("\n")) return Math.max(0, lines - 1);
  return lines;
}

export function buildFileNumstatHtml(file, diffChunk = "", opts = {}) {
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

export async function resolveUntrackedNumstat({ workspace, files, apiFetch }) {
  const pathToLines = {};
  if (!workspace || !Array.isArray(files) || files.length === 0) return pathToLines;

  const tasks = files
    .filter((file) => {
      const status = String(file.status || "").trim();
      const hasNumstat = file.insertions != null || file.deletions != null;
      return (status === "??" || status === "A") && !hasNumstat && (file.path || file.name);
    })
    .map(async (file) => {
      const path = file.path || file.name;
      const res = await apiFetch(
        `/workspaces/${encodeURIComponent(workspace)}/file-content?path=${encodeURIComponent(path)}`
      );
      if (!res || !res.ok) return;
      const data = await res.json();
      if (typeof data?.content !== "string") return;
      pathToLines[path] = countContentLines(data.content);
    });
  await Promise.allSettled(tasks);

  return pathToLines;
}
