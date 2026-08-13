import { formatSize } from "./format.ts";
import { buildGitHubFileUrl } from "./git.ts";

export function joinEntryPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function splitPathSegments(path) {
  if (!path) return [];
  return path.split("/").filter(Boolean);
}

export function entrySizeText(entry) {
  if (entry.type === "file" && entry.size != null) return formatSize(entry.size);
  if (entry.type === "dir" && entry.count != null) {
    return entry.count === 1 ? "1 item" : `${entry.count} items`;
  }
  return "";
}

export function buildGitHubEntryUrl(workspace, currentPath, entry) {
  if (!workspace?.github_url || !entry) return "";
  const type = entry.type === "dir" ? "tree" : "blob";
  return buildGitHubFileUrl(
    workspace.github_url, workspace.branch || "main",
    joinEntryPath(currentPath, entry.name), type,
  );
}
