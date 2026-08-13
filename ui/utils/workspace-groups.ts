/**
 * buildFlatList / deriveGroupChanges が扱うフラットリストの1行。
 * グループ見出し行（header）とワークスペース行（ws）の2種類。
 */
type FlatListItem =
  | { type: "header"; group: Record<string, any>; groupIdx: number }
  | { type: "ws"; ws: Record<string, any>; groupId: string | null };

/**
 * 指定グループに属するワークスペースを返す（groupId が null/undefined なら
 * グループ未所属＝トップレベル）。ベースが登録済みの worktree はベース行の
 * 下に別途表示されるため一覧からは除外する。
 * WorkspaceOpen.vue の ungrouped / groupedWorkspaces 共通のフィルタ。
 *
 * @param list 全ワークスペース
 */
export function workspacesInGroup(list: Record<string, any>[], groupId: string | null = null): Record<string, any>[] {
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    (groupId == null ? !w.group_id : w.group_id === groupId) &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
}

/**
 * グループ+ワークスペースをフラットリストに変換する。
 * WorkspaceOpen.vue の flatList computed と同じロジック。
 *
 * @param ungroupedWs グループなしのワークスペース（呼び出し元でフィルタ済み）
 * @param groups グループ（順序付き）
 * @param getGroupWs グループIDを受け取りWSリストを返す関数
 * @param collapsed 折りたたみ中のグループID集合
 * @returns フラットリスト
 */
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

/**
 * ドラッグ後のフラットリストから、グループが変わったワークスペースを検出する。
 * WorkspaceOpen.vue の _saveOrderAndGroups 内の判定ロジックと同じ。
 *
 * @param finalList ドラッグ確定後のフラットリスト
 */
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
