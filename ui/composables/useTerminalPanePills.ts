import { computed, type ComputedRef, type Ref } from "vue";
import type { TerminalTab } from "../stores/terminal.ts";
import { useAgentStateStore } from "../stores/agent-state.ts";
import { useDispatchQueue } from "./useDispatchQueue.ts";
import { useDockerContainers } from "./useDockerContainers.ts";
import { useGitHubPollingFor } from "./useGitHubPolling.ts";
import { useInfoPillActions } from "./useInfoPillActions.ts";
import { usePeekPills } from "./usePeekPills.ts";
import { usePreviewPorts } from "./usePreviewPorts.ts";
import { buildPeekFields, buildPillFields } from "../utils/pill-fields.ts";
import { agentStateDescriptor, resolveAgentBadgeState } from "../utils/session-sidebar.ts";

/**
 * ターミナルペイン（TerminalPane.vue）のInfo Pills用の値: ワークスペースのポーリング
 * （Dev Server / Docker / GitHub）、ピルの表示値、peek（値の変化の表示）、バー表示用の項目。
 * @param tab ペインのタブ
 * @param paneWorkspace タブに紐付いたワークスペース（未解決なら undefined）
 */
export function useTerminalPanePills(tab: Ref<TerminalTab>, paneWorkspace: ComputedRef<Record<string, any> | undefined>) {
  // Dev Server ボタンもピルに直接出す。ポーリング自体は usePreviewPorts に集約し、
  // 開いている全タブで1本のタイマーを共有する。ワークスペース未紐付けのベアターミナルは
  // devServerEntry を絶対に持てない（下記参照）ため、それらのタブはポーリングに参加しない。
  const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling, fetchPorts: fetchPreviewPorts } = usePreviewPorts();

  // Dockerピルも Dev Server と同じ立て付け（ポーリング集約 + workspace一致でフィルタ）。
  const { containers: dockerContainers, start: startDockerPolling, stop: stopDockerPolling, fetchContainers: fetchDockerContainers } = useDockerContainers();

  // start/stop は冪等なので、ワークスペースの有無に合わせて毎回呼んでよい。
  function syncWorkspacePolling() {
    if (tab.value.workspace) {
      startPreviewPolling();
      startDockerPolling();
    } else {
      stopPreviewPolling();
      stopDockerPolling();
    }
  }

  function fetchWorkspaceResources() {
    fetchPreviewPorts();
    fetchDockerContainers();
  }

  function stopWorkspacePolling() {
    stopPreviewPolling();
    stopDockerPolling();
  }

  const githubWorkspaceKey = computed(() => (paneWorkspace.value?.is_git_repo === true && paneWorkspace.value?.github_url) ? tab.value.workspace : null);

  // GitHub PRピルは「現在のブランチに対応するPRがある時」だけ表示する
  // （無関係なPRの存在では出さない）。PR/Actions/Issuesのポーリング開始・停止は
  // useGitHubPollingFor に集約。
  const { prsByWorkspace, runsByWorkspace, issuesByWorkspace } = useGitHubPollingFor(
    computed(() => (githubWorkspaceKey.value ? [githubWorkspaceKey.value] : [])));

  const { queue: dispatchQueue, allJobs: dispatchAllJobs } = useDispatchQueue();

  // ピルの表示値はセッションサイドバーと同じ buildPillFields で組み立てる。paneWorkspace が
  // tabWorkspaceVersion に依存しているため、ワークスペースの紐付け変更でも再計算される。
  const pill = computed(() => buildPillFields(tab.value.workspace, paneWorkspace.value, {
    prsByWorkspace: prsByWorkspace.value,
    runsByWorkspace: runsByWorkspace.value,
    previewPorts: previewPorts.value,
    dockerContainers: dockerContainers.value,
    issuesByWorkspace: issuesByWorkspace.value,
    dispatchQueue: dispatchQueue.value,
    dispatchAllJobs: dispatchAllJobs.value,
    hostname: location.hostname,
  }, tab.value.workspace || tab.value.label || ""));
  const isGitRepo = computed(() => pill.value.isGitRepo);
  const ahead = computed(() => pill.value.ahead);
  const behind = computed(() => pill.value.behind);
  const devServerEntry = computed(() => pill.value.devServerEntry);

  const { openPane } = useInfoPillActions({
    tab: tab as Ref<Record<string, any>>,
    isGitRepo,
    devServerEntry,
    ahead,
    behind,
  });

  // ピルは常にアイコンのみ表示し、値が更新された時だけピル行を隠して変化した
  // キーの情報を1本の長いピル（PillPeek.vue）に数秒だけ差し替える（peekingKey）。
  const peekFields = computed(() => buildPeekFields(tab.value, pill.value));

  // trailingPeekItems の組み立て・変化検出・キュー・タイマーは usePeekPills に集約
  // （SessionSidebarRow と共用）。
  const peek = usePeekPills({
    peekFields,
    paneWorkspace,
    sessionId: () => tab.value.sessionId,
    workspaceKey: () => tab.value.workspace,
    prsByWorkspace,
    runsByWorkspace,
    devServerEntry,
    ahead,
    behind,
  });

  function onPeekClick() {
    openPane(peek.peekingKey.value);
  }

  // バー表示の帯（SessionPillBar）がセッションサイドバーの行2と同じ項目形で受け取る。
  const agentStateStore = useAgentStateStore();
  const barItem = computed(() => ({
    ...pill.value,
    isWorktree: !!paneWorkspace.value?.worktree,
    agent: agentStateDescriptor(resolveAgentBadgeState(
      agentStateStore.agentStates[tab.value.sessionId as string],
      !!agentStateStore.doneSessions[tab.value.sessionId as string],
    )),
  }));

  return {
    pill,
    peek,
    barItem,
    openPane,
    onPeekClick,
    syncWorkspacePolling,
    fetchWorkspaceResources,
    stopWorkspacePolling,
  };
}
