<template>
  <div class="modal-scroll-body">
    <template v-for="section in serverInfoSections" :key="section.label">
      <div v-if="section.error" class="status-message error">{{ section.error }}</div>
      <template v-else>
        <div
          v-for="(row, i) in section.rows"
          :key="i"
          class="server-info-row"
          :class="{ 'server-info-header': row.header }"
          :title="row.title || ''"
        >
          <span class="server-info-label">
            {{ row.label }}
            <button
              v-if="row.refresh"
              type="button"
              class="process-refresh-btn"
              :disabled="isProcessRefreshing"
              @click="refreshProcesses"
            >
              <span class="mdi mdi-refresh" :class="{ spinning: isProcessRefreshing }"></span>
            </button>
          </span>
          <span class="server-info-values">
            <span v-for="(v, j) in row.values" :key="j" class="server-info-value">{{ v }}</span>
          </span>
        </div>
      </template>
    </template>
    <div v-if="isServerInfoLoading" class="text-muted-center">Loading...</div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Server Info";

const { apiGet } = useApi();
const isServerInfoLoading = ref(true);
const isProcessRefreshing = ref(false);
const serverInfoSections = ref([]);

const SECTION_DEFS = [
  {
    label: "Server Info",
    endpoint: "/system/info",
    toRows: (data) => [
      { label: "Hostname", values: [data.hostname] },
      { label: "OS", values: [data.os] },
      { label: "IP", values: [data.ip] },
      { label: "Uptime", values: [data.uptime] },
      { label: "Memory", values: [data.memory] },
      { label: "CPU Temp", values: [data.cpu_temp] },
      { label: "Disk", values: [data.disk] },
    ].filter((r) => r.values[0]),
  },
  {
    label: "Process List",
    endpoint: "/system/processes",
    toRows: (processes) => [
      { label: "Processes", values: ["CPU", "MEM"], header: true, refresh: true },
      ...processes.map((p) => ({
        label: p.name,
        values: [`${p.cpu.toFixed(1)}%`, `${p.mem.toFixed(1)}%`],
        title: `PID: ${p.pid}\n${p.command}`,
      })),
    ],
  },
];

async function loadServerInfoSections() {
  isServerInfoLoading.value = true;
  const results = await Promise.all(
    SECTION_DEFS.map(async (def) => {
      try {
        const { ok, data } = await apiGet(def.endpoint);
        if (!ok) return { label: def.label, error: `Failed to get ${def.label}`, rows: [] };
        return { label: def.label, rows: def.toRows(data), error: null };
      } catch (e) {
        return { label: def.label, error: e.message, rows: [] };
      }
    }),
  );
  serverInfoSections.value = results;
  isServerInfoLoading.value = false;
}

async function refreshProcesses() {
  if (isProcessRefreshing.value) return;
  isProcessRefreshing.value = true;
  try {
    const def = SECTION_DEFS[1];
    const { ok, data } = await apiGet(def.endpoint);
    if (ok) {
      const sections = [...serverInfoSections.value];
      sections[1] = { label: def.label, rows: def.toRows(data), error: null };
      serverInfoSections.value = sections;
    }
  } finally {
    isProcessRefreshing.value = false;
  }
}

onMounted(loadServerInfoSections);

defineExpose({
  load: loadServerInfoSections,
  loadServerInfoSections,
});
</script>

<style scoped>
.server-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  min-height: 32px;
}

.server-info-row:last-child {
  border-bottom: none;
}

.server-info-label {
  color: var(--text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-info-values {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.server-info-value {
  color: var(--text-primary);
  text-align: right;
  min-width: 44px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.server-info-header {
  min-height: 0;
  padding: 2px 4px;
  margin-top: 30px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}

.server-info-header .server-info-value {
  color: var(--text-muted);
}

.process-refresh-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 2px 4px;
  margin-left: 4px;
  cursor: pointer;
  font-size: 14px;
  vertical-align: middle;
  line-height: 1;
}

.process-refresh-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.process-refresh-btn .spinning {
  display: inline-block;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
