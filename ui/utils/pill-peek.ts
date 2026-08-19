// ピル群のいずれかの値が更新された時、ピル行を丸ごと隠して変化したキーの
// 情報を載せた1本の長いピル（PillPeek.vue）に数秒だけ差し替えるための純粋ロジック。
// ここでは変化検出に必要な最小限の値（key + 見た目に影響する text）だけを扱う。
// TerminalPane（浮遊ピル）とセッションサイドバー行の両方から共用する。

/**
 * @returns key -> text のシグネチャ
 */
export function trailingItemsSignature(items: { key: string; text: string }[]): Map<string, string> {
  return new Map((items || []).map((it) => [it.key, it.text]));
}

/**
 * 直前のシグネチャと比べて追加された、または内容が変わった項目を全て返す
 * （items の並び順のまま）。複数変化していてもキューで順番に見せるため、
 * 最初の1件だけに絞らず全件返す。変化が無ければ空配列。
 */
export function findChangedTrailingItems(
  items: { key: string; text: string }[],
  prevSignature: Map<string, string>,
): { key: string; text: string }[] {
  return (items || []).filter((it) => prevSignature.get(it.key) !== it.text);
}

/**
 * ピル群（TerminalPaneの浮遊ピル・セッションサイドバー行の両方）で共通の
 * trailingPeekItems（usePillPeekの変化検出対象）を組み立てる純粋関数。
 * 各キーはInfoPillRowの対応ボタンのv-if条件（infoPillConfig含む）と揃える
 * 必要がある（揃えないと、非表示ピルの変化がfindChangedTrailingItemsに
 * 拾われ、実際に表示されている別ピルの変化が枠を奪われてpeekされない）。
 */
export function buildTrailingPeekItems(
  fields: {
    workspaceLabel?: string;
    isGitRepo?: boolean;
    hasSession?: boolean;
    hasWorkspace?: boolean;
    isDirty?: boolean;
    changedFiles?: number;
    insertions?: number;
    deletions?: number;
    branch?: string;
    ahead?: number;
    behind?: number;
    branchPR?: { number: number; title: string } | null;
    branchAction?: { id: string | number; status: string; conclusion: string } | null;
    devServerEntry?: { proxy_port: number } | null;
    dispatchItems?: { id: string }[];
  },
  infoPillConfig: Record<string, boolean>,
): { key: string; text: string }[] {
  const {
    workspaceLabel = "",
    isGitRepo = false,
    hasSession = false,
    hasWorkspace = false,
    isDirty = false,
    changedFiles = 0,
    insertions = 0,
    deletions = 0,
    branch = "",
    ahead = 0,
    behind = 0,
    branchPR = null,
    branchAction = null,
    devServerEntry = null,
    dispatchItems = [],
  } = fields || {};
  const items: { key: string; text: string }[] = [];
  items.push({ key: "workspace", text: workspaceLabel });
  if ((isGitRepo || hasSession) && infoPillConfig.files) {
    items.push({ key: "files", text: "Files" });
  }
  if (isGitRepo && isDirty && infoPillConfig.changes) {
    items.push({ key: "changes", text: `${changedFiles}F +${insertions} -${deletions}` });
  }
  if (isGitRepo && infoPillConfig.branch) {
    items.push({ key: "branch", text: `${branch}:${ahead}:${behind}` });
  }
  if (branchPR && infoPillConfig.prs) {
    items.push({ key: "prs", text: `${branchPR.number}:${branchPR.title}` });
  }
  if (branchAction && infoPillConfig.actions) {
    items.push({ key: "actions", text: `${branchAction.id}:${branchAction.status}:${branchAction.conclusion}` });
  }
  if (devServerEntry && infoPillConfig.devserver) {
    items.push({ key: "devserver", text: `Server:${devServerEntry.proxy_port}` });
  }
  if (!hasWorkspace && hasSession && infoPillConfig.add) {
    items.push({ key: "add", text: "Add" });
  }
  if (dispatchItems.length > 0 && infoPillConfig.dispatch) {
    items.push({ key: "dispatch", text: dispatchItems.map((i) => i.id).join(",") });
  }
  return items;
}

/**
 * peekingKeyごとの表示テキストを組み立てる。changes/branchは複数トーンの
 * 色分け表示のため呼び出し側（テンプレート）で直接組み立てるので対象外。
 */
export function buildPeekText(
  peekingKey: string | null,
  fields: {
    workspaceLabel?: string;
    branchPR?: { number: number; title: string } | null;
    branchAction?: { name?: string; status: string; conclusion: string } | null;
    devServerEntry?: { proxy_port: number } | null;
    dispatchTooltip?: string;
  },
): string {
  const {
    workspaceLabel = "",
    branchPR = null,
    branchAction = null,
    devServerEntry = null,
    dispatchTooltip = "",
  } = fields || {};
  switch (peekingKey) {
    case "files": return "Files";
    case "prs": return branchPR ? `#${branchPR.number} ${branchPR.title}` : "";
    case "actions": return branchAction
      ? `[${branchAction.name}] ${branchAction.conclusion || branchAction.status}`
      : "";
    case "devserver": return devServerEntry ? `Dev Server :${devServerEntry.proxy_port}` : "Server";
    case "devserver-stop": return "Dev Server Stop";
    case "add": return "Add";
    case "dispatch": return dispatchTooltip;
    case "workspace": return workspaceLabel;
    default: return "";
  }
}

/**
 * peekピルの内容が変化した時だけ再測定するための、キーごとの比較用シグネチャ。
 * changes/branchはbuildPeekTextを経由しない独自の色分け表示のため、それぞれの
 * 元データから組み立てる。
 */
export function buildPeekSignature(
  peekingKey: string | null,
  fields: Parameters<typeof buildPeekText>[1] & { changedFiles?: number; insertions?: number; deletions?: number; branch?: string; ahead?: number; behind?: number },
): string | null {
  if (!peekingKey) return null;
  const { changedFiles = 0, insertions = 0, deletions = 0, branch = "", ahead = 0, behind = 0 } = fields || {};
  if (peekingKey === "changes") return `changes:${changedFiles}:${insertions}:${deletions}`;
  if (peekingKey === "branch") return `branch:${branch}:${ahead}:${behind}`;
  return `${peekingKey}:${buildPeekText(peekingKey, fields)}`;
}
