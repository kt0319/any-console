function summarizePrompt(text: string): string {
  if (!text) return "(no input)";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

interface ActionSummaryOptions {
  title: string;
  workspace?: string | null;
  worktree?: string | null;
  session?: string | null;
  job?: string | null;
  pane?: string | null;
  branch?: string | null;
  branchStatus?: "current" | "exists" | "missing" | "unknown" | null;
  createBranch?: boolean;
  baseBranch?: string | null;
  text?: string | null;
}

/**
 * 確認ダイアログ用の操作サマリを組み立てる。
 */
export function buildActionSummary(opts: ActionSummaryOptions): string {
  const lines: string[] = [];
  if (opts.workspace) lines.push(`Workspace: ${opts.workspace}`);
  if (opts.worktree) lines.push(`Worktree: ${opts.worktree}`);
  if (opts.session) lines.push(`Session: ${opts.session}`);
  if (opts.job && opts.job !== "terminal") lines.push(`Job: ${opts.job}`);
  if (opts.pane) lines.push(`Pane: ${opts.pane}`);
  if (opts.branch) {
    let note = "";
    if (opts.branchStatus === "current") note = " (already current)";
    else if (opts.branchStatus === "exists") note = " (checkout)";
    else if (opts.branchStatus === "missing") {
      if (opts.baseBranch) note = ` (new from "${opts.baseBranch}")`;
      else if (opts.createBranch) note = " (new branch)";
      else note = " (does not exist — will fail)";
    } else if (opts.createBranch) note = " (create if missing)";
    lines.push(`Branch: ${opts.branch}${note}`);
  }
  if (opts.text) lines.push(`Input: ${summarizePrompt(opts.text)}`);
  return `${opts.title}\n\n${lines.join("\n")}`;
}
