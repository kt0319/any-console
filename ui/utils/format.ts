import { JOB_COMMAND_PREVIEW_MAX } from "./constants.ts";

/**
 * 末尾を切り詰めて "..." を付ける（超過時のみ）。
 */
export function truncateTail(str: string | null | undefined, maxLen: number): string {
  const s = String(str || "");
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}

/**
 * ジョブ実行確認ダイアログに出すコマンドのプレビュー。コマンドが無い
 * ジョブはジョブ名でフォールバックする（WorkspaceJobsPane / Recent Jobs 共通）。
 */
export function jobCommandPreview(command: string | null | undefined, fallbackName: string): string {
  return command ? truncateTail(command, JOB_COMMAND_PREVIEW_MAX) : fallbackName;
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - epochSeconds * 1000) / 1000));

  if (diffSec < 3600) return "now";
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / (86400 * 7))}w ago`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}m ago`;
  return `${Math.floor(diffSec / (86400 * 365))}y ago`;
}
