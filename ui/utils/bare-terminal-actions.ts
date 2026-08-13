// ワークスペース未紐付けのベアターミナルで、ピルから Files 参照・ワークスペース登録を
// 行う際の判断ロジック（廃止済み WorkspaceStatusBar の isPlainTerminal 相当の挙動を踏襲）。
// API 呼び出し（cwd 取得）は呼び出し側の責務とし、ここでは結果からの分岐のみを扱う。

export function cwdBaseName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

export function resolveBareTerminalFilesDetail(
  sessionId: string | null | undefined,
  cwd: string,
): { pane: string, terminalSessionId?: string, rootLabel?: string } {
  const detail: { pane: string, terminalSessionId?: string, rootLabel?: string } = { pane: "files" };
  if (sessionId) {
    detail.terminalSessionId = sessionId;
    detail.rootLabel = cwd ? cwdBaseName(cwd) : "terminal";
  }
  return detail;
}

export function resolveRegisterCurrentDirAction(
  cwd: string,
  workspaces: Array<{ name: string, path: string, icon?: string, icon_color?: string }>,
): { type: "openModal" } | { type: "launch", workspace: string, icon: string, iconColor: string } | { type: "openAdd", initialPath: string } {
  if (!cwd) return { type: "openModal" };
  const existing = (workspaces || []).find((w) => w.path === cwd);
  if (existing) {
    return { type: "launch", workspace: existing.name, icon: existing.icon || "", iconColor: existing.icon_color || "" };
  }
  return { type: "openAdd", initialPath: cwd };
}
