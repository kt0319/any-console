export function formatRemoteToast(wsName, label, data) {
  const commits = data?.commits;
  const count = commits?.count || 0;
  const header = count > 0
    ? `${wsName}: ${label} done (${count} commit${count === 1 ? "" : "s"})`
    : `${wsName}: ${label} done`;
  const messages = Array.isArray(commits?.messages) ? commits.messages : [];
  const subjects = messages.map((m) => String(m).split("\n")[0]);
  if (!subjects.length) return header;
  const lines = [header, ...subjects.map((s) => `• ${s}`)];
  const remaining = count - subjects.length;
  if (remaining > 0) {
    lines.push(`… and ${remaining} more`);
  }
  return lines.join("\n");
}
