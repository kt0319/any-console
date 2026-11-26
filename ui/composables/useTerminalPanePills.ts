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

export function useTerminalPanePills(tab: Ref<TerminalTab>, paneWorkspace: ComputedRef<Record<string, any> | undefined>) {
  // ポーリングは usePreviewPorts で全タブ共有。ワークスペース未紐付けのベアターミナルは参加しない
  const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling, fetchPorts: fetchPreviewPorts } = usePreviewPorts();

  const { containers: dockerContainers, start: startDockerPolling, stop: stopDockerPolling, fetchContainers: fetchDockerContainers } = useDockerContainers();

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

  // 現在のブランチに対応する PR がある時だけ PR ピルを出す
  const { prsByWorkspace, runsByWorkspace, issuesByWorkspace } = useGitHubPollingFor(
    computed(() => (githubWorkspaceKey.value ? [githubWorkspaceKey.value] : [])));

  const { queue: dispatchQueue, allJobs: dispatchAllJobs } = useDispatchQueue();

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

  // 値が更新された時だけピル行を隠し、変化したキーを PillPeek.vue で数秒だけ表示する（peekingKey）
  const peekFields = computed(() => buildPeekFields(tab.value, pill.value));

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
