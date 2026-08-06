/**
 * グループ+ワークスペースをフラットリストに変換する。
 * WorkspaceOpen.vue の flatList computed と同じロジック。
 *
 * @param {object[]} ungroupedWs       - グループなしのワークスペース（呼び出し元でフィルタ済み）
 * @param {object[]} groups            - グループ（順序付き）
 * @param {(groupId: string) => object[]} getGroupWs - グループIDを受け取りWSリストを返す関数
 * @param {Set<string>} collapsed      - 折りたたみ中のグループID集合
 * @returns {object[]} フラットリスト
 */
/**
 * 指定グループに属するワークスペースを返す（groupId が null/undefined なら
 * グループ未所属＝トップレベル）。ベースが登録済みの worktree はベース行の
 * 下に別途表示されるため一覧からは除外する。
 * WorkspaceOpen.vue の ungrouped / groupedWorkspaces 共通のフィルタ。
 *
 * @param {Record<string, any>[]} list - 全ワークスペース
 * @param {string | null} [groupId]
 * @returns {Record<string, any>[]}
 */
export function workspacesInGroup(list, groupId = null) {
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    (groupId == null ? !w.group_id : w.group_id === groupId) &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
}

export function buildFlatList(ungroupedWs, groups, getGroupWs, collapsed = new Set()) {
  const result = [];

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
 * @param {object[]} finalList - ドラッグ確定後のフラットリスト
 * @returns {{ changes: {ws, newGroupId}[], visibleOrder: string[] }}
 */
export function deriveGroupChanges(finalList) {
  let currentGroupId = null;
  const changes = [];
  const visibleOrder = [];

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
