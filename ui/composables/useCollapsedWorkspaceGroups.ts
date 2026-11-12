import { reactive } from "vue";
import { LS_KEY_COLLAPSED_WORKSPACE_GROUPS } from "../utils/constants.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";

// グループの折りたたみ状態をモジュールスコープで保持し、localStorage にも保存する（再マウント・リロード後も維持）
const collapsedGroupIds = new Set<string>(
  safeJsonLoad<string[]>(LS_KEY_COLLAPSED_WORKSPACE_GROUPS, []).filter((id) => typeof id === "string"),
);

/** Open Session 一覧のワークスペースグループの開閉状態。 */
export function useCollapsedWorkspaceGroups() {
  const collapsedGroups = reactive(collapsedGroupIds);

  function toggleGroup(groupId: string) {
    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }
    safeJsonSave(LS_KEY_COLLAPSED_WORKSPACE_GROUPS, [...collapsedGroups]);
  }

  return { collapsedGroups, toggleGroup };
}
