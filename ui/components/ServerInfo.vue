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
          <button v-if="row.pid" type="button" class="si-kill-btn" aria-label="Kill process" data-tooltip="Kill process" @click="killProcess(row.pid)">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="!isLoading" class="si-card">
      <div class="si-card-head">
        <span class="si-card-title">Update</span>
        <button type="button" class="si-refresh" :disabled="upd.checking || upd.applying" @click="updCheck">
          <span class="mdi mdi-refresh" :class="{ spinning: upd.checking }"></span>
        </button>
      </div>
      <div v-if="upd.checking" class="si-row"><span class="si-label" style="color:var(--text-muted)">Checking…</span></div>
      <template v-else-if="upd.checked">
        <div v-if="!upd.status.fetch_ok" class="status-message error" style="margin:8px 12px">
          Could not reach the remote. Check network and try again.
        </div>
        <template v-else>
          <div v-if="upd.status.update_available" class="si-row">
            <span class="si-label">Latest release</span>
            <span class="si-vals" style="color:var(--accent)"><span>{{ upd.status.latest_release }}</span></span>
          </div>
          <div v-if="upd.status.update_available && upd.status.behind" class="si-row">
            <span class="si-label">Behind</span>
            <span class="si-vals"><span>{{ upd.status.behind }} commit{{ upd.status.behind === 1 ? "" : "s" }}</span></span>
          </div>
          <div v-if="!upd.status.update_available" class="si-row">
            <span class="si-label" style="color:var(--success)"><span class="mdi mdi-check-circle-outline"></span> Up to date</span>
          </div>
        </template>
      </template>
      <div v-if="upd.applied" class="status-message success" style="margin:8px 12px">
        Checked out {{ upd.status.checked_out }}. Restart to apply (<code>./any-console restart</code>).
      </div>
      <div v-if="upd.applyError" class="status-message error" style="margin:8px 12px">{{ upd.applyError }}</div>
      <div v-if="upd.checked && upd.status.update_available && upd.status.fetch_ok && !upd.applied" class="si-update-actions">
        <button type="button" class="primary" :disabled="upd.applying" @click="updApply">
          {{ upd.applying ? "Updating…" : `Update to ${upd.status.latest_release}` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useLayoutStore } from "../stores/layout.js";
import { EP_AUTH_CHECK, EP_SYSTEM_INFO, EP_SYSTEM_PROCESSES, EP_SYSTEM_UPDATE_CHECK, EP_SYSTEM_UPDATE_APPLY, EP_SYSTEM_PROCESS_KILL } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "System Info";

const { apiGet, apiPost } = useApi();
const { confirm } = useConfirm();
const layoutStore = useLayoutStore();

const upd = reactive({
  checking: false,
  checked: false,
  applying: false,
  applied: false,
  applyError: "",
  status: {
    version: "", current_release: "", latest_release: "", checked_out: "",
    behind: 0, update_available: false, fetch_ok: true,
  },
});

async function updCheck() {
  upd.checking = true;
  upd.applied = false;
  upd.applyError = "";
  const { ok, data } = await apiGet(EP_SYSTEM_UPDATE_CHECK, { errorMessage: "Failed to check for updates" });
  if (ok && data) Object.assign(upd.status, data);
  upd.checked = ok;
  upd.checking = false;
}

async function updApply() {
  if (!await confirm(`Update to ${upd.status.latest_release}? A restart is required to apply it.`)) return;
  upd.applying = true;
  upd.applyError = "";
  const { ok, data } = await apiPost(EP_SYSTEM_UPDATE_APPLY, {});
  if (ok && data?.ok) {
    if (data.version) upd.status.version = data.version;
    upd.status.checked_out = data.checked_out || upd.status.latest_release;
    upd.status.update_available = false;
    upd.applied = true;
  } else {
    upd.applyError = data?.detail || "Update failed";
  }
  upd.applying = false;
}
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

function formatAuth(auth) {
  if (!auth) return "-";
  if (auth.auth_method === "tailscale") return `Tailscale (${auth.tailscale_user})`;
  if (auth.auth_method === "device") return `Device (${auth.device?.name || "unknown"})`;
  if (auth.auth_method === "token") return "Token";
  if (auth.auth_method === "disabled") return "Disabled";
  return auth.auth_method || "-";
}
const mapProcess = (p) => ({ label: p.name, pid: p.pid, values: [`${p.cpu.toFixed(1)}%`, `${p.mem.toFixed(1)}%`] });

function yesNoUnknown(v) {
  if (v === null || v === undefined) return "Unknown";
  return v ? "Yes" : "No";
}

function tailscaleRows(ts) {
  if (!ts) return [];
  return [
    row("Version", ts.version),
    row("Serve", ts.serve_running === null ? "Unknown" : (ts.serve_running ? "Running" : "Not running")),
    row("HTTPS", yesNoUnknown(ts.https_enabled)),
    row("Auto-auth", ts.trust_auth_enabled ? "Enabled" : "Disabled"),
    row("Auth config", !ts.trust_auth_enabled ? "N/A" : (ts.auth_config_safe ? "Safe" : "Review needed")),
  ];
}

async function load() {
  isLoading.value = true;
  const get = (ep) => getWithRetry(apiGet, ep).then((r) => r.ok ? r.data : null).catch(() => null);
  const [srv, prc, auth] = await Promise.all([
    get(EP_SYSTEM_INFO), get(EP_SYSTEM_PROCESSES), get(EP_AUTH_CHECK),
  ]);

  sections.value = [
    {
      label: "any-console",
      error: srv ? null : "Failed to load",
      rows: srv ? [
        row("Version", srv.version),
        row("URL", location.origin),
        row("Auth", formatAuth(auth)),
        row("Install dir", srv.install_dir),
        row("User", srv.user),
      ].filter((r) => r.values[0]) : [],
    },
    {
      label: "Host",
      error: srv ? null : "Failed to load",
      rows: srv ? [
        row("Hostname", srv.hostname), row("OS", srv.os), row("IP", srv.ip),
        row("Uptime", srv.uptime), row("Memory", srv.memory),
        row("CPU Temp", srv.cpu_temp), row("Disk", srv.disk),
      ].filter((r) => r.values[0]) : [],
    },
    ...(srv?.tailscale ? [{
      label: "Tailscale",
      rows: tailscaleRows(srv.tailscale),
    }] : []),
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
      label: "Processes",
      error: prc ? null : "Failed to load",
      refreshable: true,
      rightValues: ["CPU", "MEM"],
      rows: prc ? prc.map(mapProcess) : [],
    },
  ];
  isLoading.value = false;
}

async function killProcess(pid) {
  if (!await confirm(`Kill process ${pid}? This sends SIGTERM.`)) return;
  const { ok } = await apiPost(EP_SYSTEM_PROCESS_KILL, { pid }, { errorMessage: "Failed to kill process" });
  if (ok) await refresh();
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

onMounted(() => { load(); updCheck(); });
defineExpose({ load });
</script>

<style scoped>
.si-body { display: flex; flex-direction: column; }
.si-card { flex-shrink: 0; }
.si-card + .si-card { margin-top: 16px; }
.si-card-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: color-mix(in srgb, var(--bg-tertiary) 80%, transparent); border-top: 2px solid var(--accent); border-bottom: 1px solid var(--border); }
.si-card-title { flex: 1; font-size: 15px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.02em; }
.si-col-heads { display: flex; gap: 16px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.si-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.si-row:last-child { border-bottom: none; }
.si-label { flex: 1; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.si-vals { display: flex; gap: 16px; color: var(--text-primary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.si-refresh { background: none; border: none; color: var(--text-muted); padding: 0; cursor: pointer; font-size: 20px; line-height: 1; }
.si-refresh:disabled { opacity: 0.4; cursor: default; }
.si-refresh .spinning { display: inline-block; animation: spin 0.6s linear infinite; }
.si-update-actions { padding: 10px 12px; }
.si-update-actions .primary { width: 100%; }
.si-kill-btn { background: none; border: none; color: var(--text-muted); padding: 0 0 0 8px; cursor: pointer; font-size: 16px; line-height: 1; flex-shrink: 0; }
@media (hover: hover) and (pointer: fine) {
  .si-kill-btn:hover { color: var(--error); }
}
</style>
