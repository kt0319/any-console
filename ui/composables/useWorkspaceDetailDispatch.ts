import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useDispatchQueue } from "./useDispatchQueue.ts";
import { dispatchWorkspaceLabel, dispatchBaseWorkspaceLabel } from "../utils/dispatch-request.ts";
import { baseWorkspaceName } from "../utils/worktree.ts";

export function useWorkspaceDetailDispatch(closeWorkspaceDetail: ((tabId?: number | null) => void) | undefined) {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { queue: dispatchQueue, recent: dispatchRecent } = useDispatchQueue();

  // Run で新規セッションが作られアクティブタブが切り替わるため、close 側で「今のアクティブタブ」を使うと新タブを誤って閉じる
  const openedForTabId = terminalStore.activeTabId;

  // 一覧⇔詳細のローカル切替状態。Settings 側の pushView に乗せると別レイヤーとして開いてしまう
  const selectedDispatchId = ref<string | null>(null);
  // dispatch ピルを押したタブの sessionId（DispatchRunView の Session 選択デフォルト）
  const dispatchPillSessionId = ref<string | null>(null);

  // バッジは pending のみ数える。タブ自体は recent だけでも履歴を見返せるよう表示する
  const dispatchPendingCount = computed(() => {
    const ws = workspaceStore.selectedWorkspace;
    if (!ws) return 0;
    return dispatchQueue.value.filter((item) => dispatchWorkspaceLabel(item.request) === ws).length;
  });

  // recent は worktree と元ディレクトリで履歴を共有する（DispatchWorkspacePane.vue と同じ規則）
  const dispatchRecentCount = computed(() => {
    const ws = workspaceStore.selectedWorkspace;
    if (!ws) return 0;
    const base = baseWorkspaceName(ws);
    return dispatchRecent.value.filter((item) => dispatchBaseWorkspaceLabel(item.request) === base).length;
  });

  function openDispatchItem(dispatchItemId: string | undefined, sessionId: string | null | undefined) {
    if (dispatchItemId) selectedDispatchId.value = dispatchItemId;
    dispatchPillSessionId.value = sessionId || null;
  }

  function resetSelection() {
    selectedDispatchId.value = null;
  }

  // Run 成功時はセッションを見せるためワークスペース詳細ごと閉じる
  function onDispatchRunDone() {
    selectedDispatchId.value = null;
    closeWorkspaceDetail?.(openedForTabId);
    // Run で別タブへ切り替わると切替後にも Detail が残ることがあるため閉じる（二重呼び出しは無害）
    closeWorkspaceDetail?.(terminalStore.activeTabId);
  }

  return {
    selectedDispatchId,
    dispatchPillSessionId,
    dispatchPendingCount,
    dispatchRecentCount,
    openDispatchItem,
    resetSelection,
    onDispatchRunDone,
  };
}
