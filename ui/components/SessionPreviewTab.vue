<template>
  <div class="preview-tab">
    <div class="settings-card-head">
      <span class="settings-card-title">Processes on <code>{{ hostname }}</code></span>
      <span class="proc-col-heads">
        <span>CPU</span>
        <span>MEM</span>
      </span>
      <button type="button" class="settings-card-refresh" :disabled="isRefreshing" @click="refreshAll">
        <span class="mdi mdi-refresh" :class="{ spinning: isRefreshing }"></span>
      </button>
    </div>
    <div v-if="!hasDevServer" class="settings-item-desc">
      No dev servers detected yet. Start one (e.g. <code>npm run dev</code>) in a terminal — it'll show up here automatically.
    </div>
    <div v-if="processError" class="status-message error">{{ processError }}</div>
    <template v-else>
      <div v-for="row in rows" :key="row.key" class="proc-row">
        <span v-if="!(row.isDevServer && !row.isSelf)" class="proc-icon">
          <span v-if="row.isJob && row.icon" v-html="renderIconStr(row.icon, row.iconColor, 20)"></span>
          <span v-else-if="row.workspace" v-html="workspaceIconHtml(row.workspace)"></span>
          <span v-else class="mdi mdi-application-outline"></span>
        </span>
        <button
          v-if="row.isDevServer && !row.isSelf"
          type="button"
          class="proc-open"
          aria-label="Open"
          data-tooltip="Open"
          @click="openPreview(row)"
        >
          <span class="mdi mdi-server"></span>
        </button>
        <span class="proc-main">
          <span class="proc-name">
            {{ row.name }}<span v-if="row.pid" class="proc-pid"> ({{ row.pid }})</span>
            <span v-if="row.isSelf" class="proc-self">this console</span>
          </span>
          <template v-if="row.isDevServer">
            <span v-if="row.workspace" class="proc-sub">{{ row.workspace }}</span>
            <span class="proc-sub">:{{ row.port }}<span v-if="row.proxyPort"> → :{{ row.proxyPort }}</span></span>
          </template>
          <span v-else-if="row.isJob && row.workspace" class="proc-sub">{{ row.workspace }}</span>
        </span>
        <span class="proc-vals">
          <span>{{ row.cpu !== undefined ? `${row.cpu.toFixed(1)}%` : "—" }}</span>
          <span>{{ row.mem !== undefined ? `${row.mem.toFixed(1)}%` : "—" }}</span>
        </span>
        <button
          type="button"
          class="proc-kill-btn commit-action-danger"
          :class="{ running: !!row.pid && killingPids.has(row.pid), 'proc-btn-hidden': !(row.pid && !row.isSelf) }"
          :disabled="!row.pid || (!!row.pid && killingPids.has(row.pid))"
          aria-label="Kill process"
          data-tooltip="Kill process"
          @click="row.pid && (row.isDevServer ? killDevServer(row) : killProcessRow(row.pid))"
        >
          <span class="mdi mdi-close"></span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { usePreviewPorts } from "../composables/usePreviewPorts.ts";
import { useDevServerOpen } from "../composables/useDevServerOpen.ts";
import { useProcessKill } from "../composables/useProcessKill.ts";
import { useApi } from "../composables/useApi.ts";
import { EP_SYSTEM_PROCESSES, EP_TERMINAL_SESSIONS } from "../utils/endpoints.ts";
import { buildProcessRows, type CombinedRow, type JobEntry, type PortEntry, type ProcessEntry } from "../utils/process-rows.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { useModalView } from "../composables/useModalView.ts";

// Settings（ModalMenu）の「Server Processes」項目から開くcurrentView（'SessionPreview'）。
// dev server（ワークスペース紐付きのポート検出）とOSプロセス一覧（Kill含む）を
// 1つの一覧に統合する。dev serverはOS上でも1つのプロセスであり、分けて出すと
// 同じプロセスが両方に重複して載ってしまうため、dev serverに該当するpidは
// Port/Workspace/Open付きの行としてprocesses（CPU順）の中の元の位置に混ぜて
// 出す（先頭に固定しない）。job（tmuxペインで実行中のジョブ）に該当するpidも
// 同様にワークスペース/ジョブ名を添えて表示する（/terminal/sessionsのpane_pid
// と突き合わせる）。

const { modalTitle } = useModalView();
modalTitle!.value = "Server Processes";

const { ports, start: startPolling, stop: stopPolling, fetchPorts } = usePreviewPorts();
const hasDevServer = computed(() => ports.value.some((p) => !p.is_self));

const workspaceStore = useWorkspaceStore();
const { confirmOpenDevServer } = useDevServerOpen();
const { killingPids, killProcess } = useProcessKill();
const hostname = location.hostname;

function workspaceIconHtml(name: string) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  return renderIconStr(ws?.icon || "mdi-console", ws?.icon_color, 20);
}

// Server pill（TerminalPane）と同じOpen/Copy選択の確認フローにする
// （直接開かず、URLだけ確認・コピーもできるようにする）。
async function openPreview(row: CombinedRow) {
  await confirmOpenDevServer({ port: row.port, proxy_port: row.proxyPort });
}

function killDevServer(row: CombinedRow) {
  return killProcess(row.pid!, {
    confirmMessage: `Kill process ${row.pid} (${row.name}, port ${row.port})? This sends SIGTERM.`,
    refetch: refreshAll,
    isGone: () => !ports.value.some((port) => port.pid === row.pid),
  });
}


const { apiGet } = useApi();
const processes = ref<ProcessEntry[]>([]);
const jobs = ref<JobEntry[]>([]);
const processError = ref("");
const isRefreshing = ref(false);

async function loadProcesses() {
  const { ok, data } = await apiGet(EP_SYSTEM_PROCESSES, { errorMessage: "Failed to load processes" });
  if (ok) { processes.value = data; processError.value = ""; }
  else processError.value = "Failed to load";
}

// 実行中のジョブ（tmuxペインで動くプロセス）もProcessesで判別できるよう、
// job_nameが付いたterminalセッションのpid（tmuxペインのpane_pid）を拾う。
async function loadJobs() {
  const { ok, data } = await apiGet(EP_TERMINAL_SESSIONS, { errorMessage: "Failed to load jobs" });
  if (!ok || !Array.isArray(data)) return;
  jobs.value = data
    .filter((s: Record<string, any>) => s.job_name && s.pid)
    .map((s: Record<string, any>) => ({
      pid: s.pid,
      workspace: s.workspace,
      jobLabel: s.job_label || s.job_name,
      icon: s.icon,
      iconColor: s.icon_color,
    }));
}

async function refreshAll() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await Promise.all([loadProcesses(), fetchPorts(), loadJobs()]);
  } finally {
    isRefreshing.value = false;
  }
}

function killProcessRow(pid: number) {
  return killProcess(pid, {
    confirmMessage: `Kill process ${pid}? This sends SIGTERM.`,
    refetch: refreshAll,
    isGone: () => !processes.value.some((p) => p.pid === pid),
  });
}

const rows = computed<CombinedRow[]>(() =>
  buildProcessRows(processes.value, ports.value as PortEntry[], jobs.value));

onMounted(() => { startPolling(); loadProcesses(); loadJobs(); });
onBeforeUnmount(stopPolling);
</script>

<style scoped>
.preview-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.proc-col-heads { display: flex; gap: 16px; width: 88px; justify-content: flex-end; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

/* dev server行・通常プロセス行を同じ列構成（アイコン/名称+補足/CPU・MEM/Open?/Kill）
   で揃え、1つの表として見えるようにする。 */
.proc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.proc-row:last-child { border-bottom: none; }
.proc-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 20px;
}
.proc-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.proc-name {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proc-pid { color: var(--text-muted); font-family: monospace; font-size: 11px; }
.proc-self {
  margin-left: 6px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.proc-sub {
  font-size: 11px;
  color: var(--accent);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proc-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--lime);
  border-radius: var(--radius);
  color: var(--lime);
  font-size: 20px;
  cursor: pointer;
  flex-shrink: 0;
}
/* Killが無い行（this console自身）でも右端の位置が揃うよう、無い時も
   DOM上は残しvisibility:hiddenで幅だけ確保する。Open（.proc-open）は
   dev server行にしか出さないボタンで、通常プロセス行にはそもそも
   表示しないため対象外（v-ifでDOMごと消す）。 */
.proc-btn-hidden {
  visibility: hidden;
  pointer-events: none;
}
code {
  font-family: monospace;
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
}

.proc-vals { display: flex; gap: 16px; width: 88px; justify-content: flex-end; color: var(--text-primary); font-variant-numeric: tabular-nums; font-size: 12px; flex-shrink: 0; }
/* color/border-colorは.commit-action-danger（base.css）が担う。 */
.proc-kill-btn { position: relative; background: none; border: none; padding: 0; cursor: pointer; font-size: 16px; line-height: 1; flex-shrink: 0; }

.proc-kill-btn.running {
  pointer-events: none;
  color: transparent;
}
.proc-kill-btn.running > * {
  visibility: hidden;
}
.proc-kill-btn.running::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  border: 2px solid var(--error-bg-20);
  border-top-color: var(--error);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
