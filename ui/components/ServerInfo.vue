<template>
  <div class="modal-scroll-body si-body">
    <div v-if="isLoading" class="text-muted-center loading-dots">Loading</div>
    <div v-else v-for="section in sections" :key="section.label" class="si-card">
      <div class="settings-card-head">
        <span class="settings-card-title">{{ section.label }}</span>
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

    <div v-if="!isLoading && serverInfo?.updatable" class="si-card">
      <div class="settings-card-head">
        <span class="settings-card-title">Update</span>
        <button type="button" class="settings-card-refresh" :disabled="upd.checking || upd.applying" aria-label="Check for updates" data-tooltip="Check for updates" @click="updCheck">
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

    <button v-if="!isLoading" type="button" class="si-copy-btn" @click="copyAll">
      <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>
      {{ copied ? "Copied!" : "Copy" }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { EP_AUTH_CHECK, EP_SYSTEM_INFO, EP_SYSTEM_UPDATE_CHECK, EP_SYSTEM_UPDATE_APPLY } from "../utils/endpoints.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

const { modalTitle } = useModalView();
modalTitle!.value = "System Info";

const { apiGet, apiPost } = useApi();
const { confirm } = useConfirm();
const layoutStore = useLayoutStore();
const { copied, copy } = useCopyFeedback();

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
// 1カードの1行分。
type SiRow = { label: string, values: (string | number)[] };
type SiSection = {
  label: string,
  rows: SiRow[],
  error?: string | null,
};

const isLoading = ref(true);
const sections = ref<SiSection[]>([]);
// /system/info のレスポンス（updatableフラグをテンプレート側のUpdateカード
// 表示条件に使うため、load()内のローカル値をrefとして保持する）。
const serverInfo = ref<Record<string, any> | null>(null);

function parseBrowser(ua: string) {
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

const row = (label: string, value: string | number | undefined | null): SiRow => ({ label, values: [value ?? ""] });

function formatAuth(auth: Record<string, any> | null) {
  if (!auth) return "-";
  if (auth.auth_method === "device") return `Device (${auth.device?.name || "unknown"})`;
  if (auth.auth_method === "token") return "Token";
  if (auth.auth_method === "disabled") return "Disabled";
  return auth.auth_method || "-";
}

function tailscaleRows(ts: Record<string, any> | null | undefined) {
  if (!ts) return [];
  return [
    row("Version", ts.version),
    row("Serve", ts.serve_running === null ? "Unknown" : (ts.serve_running ? "Running" : "Not running")),
  ];
}

async function load() {
  isLoading.value = true;
  const get = (ep: string) => getWithRetry(apiGet, ep).then((r) => r.ok ? r.data : null).catch(() => null);
  const [srv, auth] = await Promise.all([
    get(EP_SYSTEM_INFO), get(EP_AUTH_CHECK),
  ]);
  serverInfo.value = srv;

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
        row("GitHub CLI", srv.gh_authenticated ? `Logged in (${srv.gh_user})` : "Not logged in"),
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
        // userAgentData は lib.dom 未定義（Chromium系のみの実験的API）のため型だけ補う。
        row("Platform", (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "-"),
        row("Screen", `${screen.width} x ${screen.height}`),
        row("Viewport", `${window.innerWidth} x ${window.innerHeight}`),
        row("Touch", layoutStore.isTouchDevice ? "Yes" : "No"),
        row("PWA", layoutStore.isPwa ? "Yes" : "No"),
        row("Online", navigator.onLine ? "Yes" : "No"),
        row("Language", navigator.language),
      ],
    },
  ];
  isLoading.value = false;
}

function buildSummaryText() {
  return sections.value
    .filter((s) => !s.error && s.rows.length)
    .map((s) => `${s.label}\n${s.rows.map((r) => `${r.label}: ${r.values.join(" ")}`).join("\n")}`)
    .join("\n\n");
}

async function copyAll() {
  await copy(buildSummaryText());
}

onMounted(() => { load(); updCheck(); });
defineExpose({ load });
</script>

<style scoped>
.si-body { display: flex; flex-direction: column; }
.si-card { flex-shrink: 0; }
.si-card + .si-card { margin-top: 16px; }
.si-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.si-row:last-child { border-bottom: none; }
.si-label { flex: 1; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.si-vals { display: flex; gap: 16px; color: var(--text-primary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.si-update-actions { padding: 10px 12px; }
.si-update-actions .primary { width: 100%; }
.si-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 16px 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}
</style>
