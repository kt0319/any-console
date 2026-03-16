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
          <span class="server-info-label">{{ row.label }}</span>
          <span class="server-info-values">
            <span v-for="(v, j) in row.values" :key="j" class="server-info-value">{{ v }}</span>
          </span>
        </div>
      </template>
    </template>
    <div v-if="isServerInfoLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "サーバー情報";

const { apiGet } = useApi();
const isServerInfoLoading = ref(true);
const serverInfoSections = ref([]);

const SECTION_DEFS = [
  {
    label: "サーバー情報",
    endpoint: "/system/info",
    toRows: (data) => [
      { label: "ホスト名", values: [data.hostname] },
      { label: "OS", values: [data.os] },
      { label: "IP", values: [data.ip] },
      { label: "稼働時間", values: [data.uptime] },
      { label: "メモリ", values: [data.memory] },
      { label: "CPU温度", values: [data.cpu_temp] },
      { label: "ディスク", values: [data.disk] },
    ].filter((r) => r.values[0]),
  },
  {
    label: "プロセス一覧",
    endpoint: "/system/processes",
    toRows: (processes) => [
      { label: "プロセス", values: ["CPU", "MEM"], header: true },
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
        if (!ok) return { label: def.label, error: `${def.label}の取得に失敗しました`, rows: [] };
        return { label: def.label, rows: def.toRows(data), error: null };
      } catch (e) {
        return { label: def.label, error: e.message, rows: [] };
      }
    }),
  );
  serverInfoSections.value = results;
  isServerInfoLoading.value = false;
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
</style>
