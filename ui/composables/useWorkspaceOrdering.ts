import { computed, type ComputedRef, type Ref } from "vue";
import { useApi } from "./useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useListDragSort } from "./useListDragSort.ts";
import { useWorkspaceListDrag } from "./useWorkspaceListDrag.ts";
import { deriveGroupChanges } from "../utils/workspace-groups.ts";
import { EP_GROUP_ORDER, EP_WORKSPACE_ORDER } from "../utils/endpoints.ts";

type FlatRow = { type: string } & Record<string, any>;

/**
 * Open Session 一覧の並べ替え永続化（WorkspaceOpen.vue から抽出）。
 * - グループヘッダーのドラッグ → /group-order 保存
 * - ワークスペース行のドラッグ → グループ所属の変更 + /workspace-order 保存
 * 呼び出し側はアンマウント時に cleanupWsDrag を呼ぶこと。
 */
export function useWorkspaceOrdering(options: {
  flatList: ComputedRef<FlatRow[]>,
  listEl: Ref<HTMLElement | null>,
}) {
  const workspaceStore = useWorkspaceStore();
  const { apiPut, wsEndpoint } = useApi();

  // ---- グループドラッグ ----
  const { dragFromIdx, dragOverIdx: groupDragOver, onDragStart: onGroupDragStart } = useListDragSort({
    rowSelector: ".picker-group-header",
    onReorder: async (from, to) => {
      const groups = [...workspaceStore.groups];
      const [moved] = groups.splice(from, 1);
      groups.splice(to, 0, moved);
      await apiPut(EP_GROUP_ORDER, { order: groups.map((g) => g.id) }, { errorMessage: "Failed to save group order" });
      await workspaceStore.fetchGroups();
    },
  });
  // null は「非ドラッグ中」（テンプレートの数値比較は常に false になる）。
  // 比較式の型エラーを避けるため number として扱う（実行時の値・挙動は不変）。
  const groupDragFrom = computed(() => dragFromIdx.value as number);

  async function saveOrderAndGroups(finalList: FlatRow[]) {
    const { changes: groupChanges, visibleOrder } = deriveGroupChanges(finalList as Parameters<typeof deriveGroupChanges>[0]);

    // グループ変更を保存
    for (const { ws, newGroupId } of groupChanges) {
      await apiPut(wsEndpoint(ws.name, "config"), {
        icon: ws.icon || "",
        icon_color: ws.icon_color || "",
        group_id: newGroupId,
      }, { errorMessage: "Failed to update group" });
    }

    // 非表示(折りたたみ)のワークスペースを末尾に温存してフル順序を構築
    const allWsIds = workspaceStore.allWorkspaces.map((ws) => ws.id || ws.name);
    const visibleSet = new Set(visibleOrder);
    const hiddenOrder = allWsIds.filter((id) => !visibleSet.has(id));
    const fullOrder = [...visibleOrder, ...hiddenOrder];

    await apiPut(EP_WORKSPACE_ORDER, { order: fullOrder }, { errorMessage: "Failed to save workspace order" });
    await workspaceStore.fetchWorkspaces();
  }

  // ---- ワークスペースドラッグ ----
  const { dragIdx, dragOffsetY, dragFlatList, onDragStart, cleanup: cleanupWsDrag } = useWorkspaceListDrag({
    flatList: options.flatList,
    listEl: options.listEl,
    onReorder: saveOrderAndGroups,
  });

  return {
    groupDragFrom,
    groupDragOver,
    onGroupDragStart,
    dragIdx,
    dragOffsetY,
    dragFlatList,
    onDragStart,
    cleanupWsDrag,
  };
}
