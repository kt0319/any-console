<template>
  <div class="modal-scroll-body">
    <template v-for="section in sections" :key="section.label">
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
    <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useAuthStore } from "../stores/auth.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "サーバー情報";

const auth = useAuthStore();
const loading = ref(true);
const sections = ref([]);

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

async function load() {
  loading.value = true;
  const results = await Promise.all(
    SECTION_DEFS.map(async (def) => {
      try {
        const res = await auth.apiFetch(def.endpoint);
        if (!res || !res.ok) return { label: def.label, error: `${def.label}の取得に失敗しました`, rows: [] };
        const data = await res.json();
        return { label: def.label, rows: def.toRows(data), error: null };
      } catch (e) {
        return { label: def.label, error: e.message, rows: [] };
      }
    }),
  );
  sections.value = results;
  loading.value = false;
}

onMounted(load);

defineExpose({ load });
</script>
