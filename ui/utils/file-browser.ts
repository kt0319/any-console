import { formatSize } from "./format.ts";
import { buildGitHubFileUrl } from "./git.ts";

type FileEntry = {
  type: "file" | "dir";
  name: string;
  size?: number | null;
  count?: number | null;
};

type WorkspaceLike = {
  github_url?: string | null;
  branch?: string | null;
} | null | undefined;

export function joinEntryPath(parentPath: string | null | undefined, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function splitPathSegments(path: string | null | undefined) {
  if (!path) return [];
  return path.split("/").filter(Boolean);
}

export function entrySizeText(entry: FileEntry) {
  if (entry.type === "file" && entry.size != null) return formatSize(entry.size);
  if (entry.type === "dir" && entry.count != null) {
    return entry.count === 1 ? "1 item" : `${entry.count} items`;
  }
  return "";
}

export function buildGitHubEntryUrl(workspace: WorkspaceLike, currentPath: string | null | undefined, entry: FileEntry | null | undefined) {
  if (!workspace?.github_url || !entry) return "";
  const type = entry.type === "dir" ? "tree" : "blob";
  return buildGitHubFileUrl(
    workspace.github_url, workspace.branch || "main",
    joinEntryPath(currentPath, entry.name), type,
  );
}
