<template>
  <div class="modal-scroll-body si-body">
    <div v-if="isLoading" class="text-muted-center">Loading...</div>
    <div v-else v-for="section in sections" :key="section.label" class="si-card">
      <div class="si-card-head">
        <span class="si-card-title">{{ section.label }}</span>
        <button v-if="section.refreshable" type="button" class="si-refresh" :disabled="isRefreshing" @click="refresh">
          <span class="mdi mdi-refresh" :class="{ spinning: isRefreshing }"></span>
        </button>
        <span v-if="section.rightValues" class="si-col-heads">
          <span v-for="v in section.rightValues" :key="v">{{ v }}</span>
        </span>
      </div>
      <div v-if="section.error" class="status-message error">{{ section.error }}</div>
      <div v-else>
        <div v-for="(row, i) in section.rows" :key="i" class="si-row">
          <span class="si-label">{{ row.label }}</span>
          <span class="si-vals">
            <span v-for="v in row.values" :key="v">{{ v }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useLayoutStore } from "../stores/layout.js";
import { EP_SYSTEM_INFO, EP_SYSTEM_PROCESSES, EP_SYSTEM_TMUX_INFO } from "../utils/endpoints.js";
import { formatRelativeTime } from "../utils/format.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "System Info";

const { apiGet } = useApi();
const layoutStore = useLayoutStore();
const isLoading = ref(true);
const isRefreshing = ref(false);
const sections = ref([]);

function parseBrowser(ua) {
  for (const [re, name] of [
    [/Edg(?:e|A|iOS)?\/(\S+)/, "Edge"],
    [/OPR\/(\S+)|Opera\/(\S+)/, "Opera"],
    [/Chrome\/(\S+)/, "Chrome"],
    [/Version\/(\S+).*Safari/, "Safari"],
    [/Firefox\/(\S+)/, "Firefox"],
  ]) {
    const m = ua.match(re);
    if (m) return `${name} ${(m[1] || m[2]).split(".").slice(0, 2).join(".")}`;
  }
  return ua.slice(0, 50);
}

const row = (label, value) => ({ label, values: [value] });
const mapProcess = (p) => ({ label: p.name, values: [`${p.cpu.toFixed(1)}%`, `${p.mem.toFixed(1)}%`] });

async function load() {
  isLoading.value = true;
  const get = (ep) => apiGet(ep).then((r) => r.ok ? r.data : null).catch(() => null);
  const [srv, prc, tmx] = await Promise.all([get(EP_SYSTEM_INFO), get(EP_SYSTEM_PROCESSES), get(EP_SYSTEM_TMUX_INFO)]);

  sections.value = [
    {
      label: "Client",
      rows: [
        row("Browser", parseBrowser(navigator.userAgent)),
        row("Platform", navigator.userAgentData?.platform || navigator.platform || "-"),
        row("Screen", `${screen.width} x ${screen.height}`),
        row("Viewport", `${window.innerWidth} x ${window.innerHeight}`),
        row("Touch", layoutStore.isTouchDevice ? "Yes" : "No"),
        row("PWA", layoutStore.isPwa ? "Yes" : "No"),
        row("Online", navigator.onLine ? "Yes" : "No"),
        row("Language", navigator.language),
      ],
    },
    {
      label: "Server",
      error: srv ? null : "Failed to load",
      rows: srv ? [
        row("Hostname", srv.hostname), row("OS", srv.os), row("IP", srv.ip),
        row("Uptime", srv.uptime), row("Memory", srv.memory),
        row("CPU Temp", srv.cpu_temp), row("Disk", srv.disk),
      ].filter((r) => r.values[0]) : [],
    },
    {
      label: "Processes",
      error: prc ? null : "Failed to load",
      refreshable: true,
      rightValues: ["CPU", "MEM"],
      rows: prc ? prc.map(mapProcess) : [],
    },
    {
      label: "tmux",
      error: tmx ? null : "Failed to load",
      rightValues: tmx ? (tmx.available ? [tmx.version] : ["not available"]) : undefined,
      rows: tmx?.available ? tmx.sessions.map((s) => {
        const tags = [`${s.windows}w`];
        if (s.attached) tags.push("attached");
        if (s.created) tags.push(formatRelativeTime(s.created * 1000));
        return { label: s.name, values: tags };
      }) : [],
    },
  ];
  isLoading.value = false;
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    const { ok, data } = await apiGet(EP_SYSTEM_PROCESSES);
    if (ok) {
      const idx = sections.value.findIndex((s) => s.refreshable);
      if (idx >= 0) sections.value[idx] = { ...sections.value[idx], rows: data.map(mapProcess) };
    }
  } finally {
    isRefreshing.value = false;
  }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.si-body { display: flex; flex-direction: column; }
.si-card { flex-shrink: 0; }
.si-card + .si-card { margin-top: 4px; }
.si-card-head { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.si-card-title { flex: 1; font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.si-col-heads { display: flex; gap: 16px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.si-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.si-row:last-child { border-bottom: none; }
.si-label { flex: 1; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.si-vals { display: flex; gap: 16px; color: var(--text-primary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.si-refresh { background: none; border: none; color: var(--text-muted); padding: 0; cursor: pointer; font-size: 20px; line-height: 1; }
.si-refresh:disabled { opacity: 0.4; cursor: default; }
.si-refresh .spinning { display: inline-block; animation: spin 0.6s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
