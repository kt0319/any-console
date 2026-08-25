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

/**
 * ローカル時刻の HH:MM:SS 表示（Dispatch Queue の受付/決定時刻など、
 * 秒単位の精度で「いつ」を確認したい場面向け。formatRelativeTime は
 * 1時間未満を"now"に丸めるため秒単位の用途には使えない）。
 */
export function formatClockTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null) return "";
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * ローカル日時の "M/D HH:MM:SS" 表示（Dispatch Queue の受付/決定時刻など、
 * 日をまたぐ履歴でも「いつ」を一意に確認したい場面向け）。
 */
export function formatClockDateTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null) return "";
  const date = new Date(epochSeconds * 1000).toLocaleDateString([], { month: "numeric", day: "numeric" });
  return `${date} ${formatClockTime(epochSeconds)}`;
}

/**
 * 分単位の相対時刻表示（Dispatch Queue向け）。formatRelativeTimeは
 * 1時間未満を"now"に丸めるため、直近の受付/決定時刻を「何分前」で
 * 確認したい場面には粗すぎる。
 */
export function formatMinutesAgo(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - epochSeconds * 1000) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
}

/**
 * 秒数を "3s" / "2m 5s" / "1h 3m" のような簡潔な経過時間表示にする
 * （Dispatch Queue の受付〜決定までの待ち時間表示向け）。
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
