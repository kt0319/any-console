/**
 * @param {string} text
 * @returns {string}
 */
function summarizePrompt(text) {
  if (!text) return "(no input)";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

/**
 * @param {string} status
 * @param {boolean} createIfMissing
 * @param {string|null} baseBranch
 */
function branchNote(status, createIfMissing, baseBranch) {
  if (status === "current") return " (already current)";
  if (status === "exists") return " (checkout)";
  if (status === "missing") {
    if (baseBranch) return ` (new from "${baseBranch}")`;
    if (createIfMissing) return " (new branch)";
    return " (does not exist — will fail)";
  }
  if (createIfMissing) return " (create if missing)";
  return "";
}

/**
 * 確認ダイアログ用の操作サマリを組み立てる。
 * @param {{
 *   title: string,
 *   workspace?: string|null,
 *   session?: string|null,
 *   job?: string|null,
 *   pane?: string|null,
 *   branch?: string|null,
 *   branchStatus?: "current"|"exists"|"missing"|"unknown"|null,
 *   createBranch?: boolean,
 *   baseBranch?: string|null,
 *   text?: string|null,
 * }} opts
 */
export function buildActionSummary(opts) {
  const lines = [];
  if (opts.workspace) lines.push(`Workspace: ${opts.workspace}`);
  if (opts.session) lines.push(`Session: ${opts.session}`);
  if (opts.job && opts.job !== "terminal") lines.push(`Job: ${opts.job}`);
  if (opts.pane) lines.push(`Pane: ${opts.pane}`);
  if (opts.branch) {
    lines.push(`Branch: ${opts.branch}${branchNote(opts.branchStatus, opts.createBranch, opts.baseBranch)}`);
  }
  if (opts.text) lines.push(`Input: ${summarizePrompt(opts.text)}`);
  return `${opts.title}\n\n${lines.join("\n")}`;
}
