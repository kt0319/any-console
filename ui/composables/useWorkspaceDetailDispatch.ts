import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useDispatchQueue } from "./useDispatchQueue.ts";
import { dispatchWorkspaceLabel, dispatchBaseWorkspaceLabel } from "../utils/dispatch-request.ts";
import { baseWorkspaceName } from "../utils/worktree.ts";

/**
 * WorkspaceDetail の Dispatch タブに関する状態（承認待ち一覧⇔詳細のローカル
 * 画面遷移・件数バッジ・Run完了時の後始末）をまとめる composable。
 * WorkspaceDetail から切り出したもの。
 */
export function useWorkspaceDetailDispatch(closeWorkspaceDetail: ((tabId?: number | null) => void) | undefined) {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { queue: dispatchQueue, recent: dispatchRecent } = useDispatchQueue();

  // このcomposableが生成された時点（=WorkspaceDetailの現在インスタンスがマウントされた時点）の
  // アクティブタブID。Dispatch Runで新規セッションが作られアクティブタブが切り替わることが
  // あるため、close側で「今アクティブなタブ」を使うと切り替わった後の新タブを誤って
  // 閉じてしまう（useWorkspaceDetailNav.ts参照）。
  const openedForTabId = terminalStore.activeTabId;

  // DispatchWorkspacePane（一覧）→DispatchRunView（1件の詳細/実行）をローカルに
  // 切り替えるための状態。Settings側のpushViewには乗せない（別レイヤーとして開いてしまうため）。
  const selectedDispatchId = ref<string | null>(null);
  // dispatchピルを押したタブ自身のsessionId（open()のsessionIdオプション経由）。
  // DispatchRunViewのSession選択のデフォルトに使う。
  const dispatchPillSessionId = ref<string | null>(null);

  // タブのバッジ数字は承認待ち（pending）件数のみでよい（実行済みrecentは
  // 件数に含めない）。ただしタブ自体の表示可否はrecentしか無い場合でも
  // 履歴を見返せるよう、pending/recentのどちらかがあれば出す。
  const dispatchPendingCount = computed(() => {
    const ws = workspaceStore.selectedWorkspace;
    if (!ws) return 0;
    return dispatchQueue.value.filter((item) => dispatchWorkspaceLabel(item.request) === ws).length;
  });

  // recentはworktreeと元のディレクトリで履歴を共有する（DispatchWorkspacePane.vue
  // と同じ規則。ベースワークスペース名同士で突き合わせる）。
  const dispatchRecentCount = computed(() => {
    const ws = workspaceStore.selectedWorkspace;
    if (!ws) return 0;
    const base = baseWorkspaceName(ws);
    return dispatchRecent.value.filter((item) => dispatchBaseWorkspaceLabel(item.request) === base).length;
  });

  // dispatch通知タップ等、特定の1件を直接開きたい場合（vue-main.ts参照）。
  function openDispatchItem(dispatchItemId: string | undefined, sessionId: string | null | undefined) {
    if (dispatchItemId) selectedDispatchId.value = dispatchItemId;
    dispatchPillSessionId.value = sessionId || null;
  }

  function resetSelection() {
    selectedDispatchId.value = null;
  }

  // Run成功時、そのままセッションを見せたいのでワークスペース詳細ごと閉じる
  // （WorkspaceDetailModal.vueがuseWorkspaceDetailNav.tsのcloseをprovideする）。
  function onDispatchRunDone() {
    selectedDispatchId.value = null;
    closeWorkspaceDetail?.(openedForTabId);
    // Runで既存セッションへ切り替わった場合、切替後の別タブ側にDetailが開いたまま
    // 残ることがあるため念のため閉じる（openedForTabIdと同じなら二重呼び出しで無害）。
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
