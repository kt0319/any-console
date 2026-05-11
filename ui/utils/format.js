export function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(epochSeconds) {
  if (epochSeconds == null) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - epochSeconds * 1000) / 1000));

  if (diffSec < 3600) return "now";
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / (86400 * 7))}w ago`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}m ago`;
  return `${Math.floor(diffSec / (86400 * 365))}y ago`;
}
