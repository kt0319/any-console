type FlatListItem =
  | { type: "header"; group: Record<string, any>; groupIdx: number }
  | { type: "ws"; ws: Record<string, any>; groupId: string | null };

// groupId が null/undefined ならトップレベル。ベースが登録済みの worktree はベース行の下に出すため除外する
export function workspacesInGroup(list: Record<string, any>[], groupId: string | null = null): Record<string, any>[] {
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    (groupId == null ? !w.group_id : w.group_id === groupId) &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
}

export function buildFlatList(
  ungroupedWs: Record<string, any>[],
  groups: Record<string, any>[],
  getGroupWs: (groupId: string) => Record<string, any>[],
  collapsed: Set<string> = new Set(),
): FlatListItem[] {
  const result: FlatListItem[] = [];

  for (const ws of ungroupedWs) {
    result.push({ type: "ws", ws, groupId: null });
  }

  groups.forEach((group, groupIdx) => {
    result.push({ type: "header", group, groupIdx });
    if (!collapsed.has(group.id)) {
      for (const ws of getGroupWs(group.id)) {
        result.push({ type: "ws", ws, groupId: group.id });
      }
    }
  });

  return result;
}

export function deriveGroupChanges(finalList: FlatListItem[]): {
  changes: { ws: Record<string, any>; newGroupId: string | null }[];
  visibleOrder: string[];
} {
  let currentGroupId: string | null = null;
  const changes: { ws: Record<string, any>; newGroupId: string | null }[] = [];
  const visibleOrder: string[] = [];

  for (const item of finalList) {
    if (item.type === "header") {
      currentGroupId = item.group.id;
    } else if (item.type === "ws") {
      visibleOrder.push(item.ws.id || item.ws.name);
      if (currentGroupId !== item.groupId) {
        changes.push({ ws: item.ws, newGroupId: currentGroupId });
      }
    }
  }

  return { changes, visibleOrder };
}
