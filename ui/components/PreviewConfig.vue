<template>
  <div class="modal-scroll-body">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="preview-head">
        <div class="settings-item-desc">
          Detected local dev server ports. Tap Open to view in a new tab.
        </div>
        <button type="button" class="preview-refresh" :disabled="refreshing" @click="reload" title="Refresh">
          <span class="mdi mdi-refresh" :class="{ spinning: refreshing }"></span>
        </button>
      </div>
      <div v-if="!ports.length" class="settings-item-desc">
        No ports detected yet. Start a dev server (e.g. <code>npm run dev</code>) in a terminal.
      </div>
      <div v-for="p in ports" :key="`${p.session_id}-${p.port}`" class="preview-row">
        <div class="preview-meta">
          <span class="preview-port">
            :{{ p.port }}
            <span v-if="p.proxy_port" class="preview-proxy"> → :{{ p.proxy_port }}</span>
            <span v-if="p.is_self" class="preview-self">this console</span>
          </span>
          <span class="preview-sub">{{ p.process }}<span v-if="p.pid"> (pid {{ p.pid }})</span></span>
        </div>
        <template v-if="!p.is_self">
          <button type="button" class="preview-copy" :title="copiedPort === p.port ? 'Copied!' : 'Copy URL'" @click="copyUrl(p)">
            <span class="mdi" :class="copiedPort === p.port ? 'mdi-check' : 'mdi-content-copy'"></span>
          </button>
          <a class="preview-open" :href="buildPreviewUrl(p)" target="_blank" rel="noopener noreferrer external" title="Open in new tab">
            <span class="mdi mdi-open-in-new"></span> Open
          </a>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Port Preview";

const { apiGet } = useApi();
const loading = ref(true);
const refreshing = ref(false);
const ports = ref([]);
const copiedPort = ref(null);

function buildPreviewUrl(p) {
  // ユニークポート方式: any-console が target+20000 で TCP proxy を立てている。
  // HTTPS の any-console から開いた場合でも、preview 自体は http (proxy は TLS なし)。
  if (!p.proxy_port) return "";
  return `http://${location.hostname}:${p.proxy_port}/`;
}

async function copyUrl(p) {
  const url = buildPreviewUrl(p);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Clipboard API が使えない環境（PWA + http など）のフォールバック
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  copiedPort.value = p.port;
  setTimeout(() => {
    if (copiedPort.value === p.port) copiedPort.value = null;
  }, 1500);
}

async function reload() {
  refreshing.value = true;
  try {
    const { ok, data } = await apiGet("/preview/ports");
    ports.value = ok && Array.isArray(data) ? data : [];
  } finally {
    refreshing.value = false;
  }
}

onMounted(async () => {
  await reload();
  loading.value = false;
});
</script>

<style scoped>
.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.preview-port {
  font-size: 16px;
  font-family: monospace;
  color: var(--text-primary);
}
.preview-label {
  font-size: 12px;
  color: var(--accent);
}
.preview-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
}
.preview-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 16px;
  cursor: pointer;
}
.preview-proxy {
  color: var(--accent);
  font-size: 13px;
}
.preview-self {
  margin-left: 6px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.preview-skip {
  font-size: 12px;
  color: var(--text-muted);
}
.preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.preview-head .settings-item-desc {
  flex: 1;
  margin: 0;
}
.preview-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
code {
  font-family: monospace;
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
