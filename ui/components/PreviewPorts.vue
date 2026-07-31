<template>
  <div class="modal-scroll-body">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="settings-item-desc">
        Detected local dev servers on <code>{{ hostname }}</code>.
      </div>
      <div v-if="!ports.length" class="settings-item-desc">
        No ports detected yet. Start a dev server (e.g. <code>npm run dev</code>) in a terminal.
      </div>
      <div v-for="p in ports" :key="`${p.session_id}-${p.port}`" class="preview-row">
        <div class="preview-meta">
          <div class="preview-top-row">
            <span v-if="p.workspace" class="preview-label">
              <span v-html="workspaceIconHtml(p.workspace)"></span>{{ p.workspace }}
            </span>
            <span v-else class="preview-label preview-label-none">No workspace</span>
            <span class="preview-sub">{{ p.process }}<span v-if="p.pid"> [pid {{ p.pid }}]</span></span>
          </div>
          <span class="preview-port">
            :{{ p.port }}
            <span v-if="p.proxy_port" class="preview-proxy"> → :{{ p.proxy_port }}</span>
            <span v-if="p.is_self" class="preview-self">this console</span>
          </span>
        </div>
        <template v-if="!p.is_self">
          <button type="button" class="preview-copy" :title="copiedPort === p.port ? 'Copied!' : 'Copy URL'" @click="copyUrl(p)">
            <span class="mdi" :class="copiedPort === p.port ? 'mdi-check' : 'mdi-content-copy'"></span>
          </button>
          <button type="button" class="preview-open" @click="openPreview(p)">
            <span class="mdi mdi-open-in-new"></span> Open
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted } from "vue";
import { usePreviewWatch } from "../composables/usePreviewWatch.js";
import { copyText } from "../utils/clipboard.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Dev Server Preview";

const { start, stop, ports } = usePreviewWatch();
const workspaceStore = useWorkspaceStore();
const loading = ref(true);
const copiedPort = ref(null);
const hostname = location.hostname;

function workspaceIconHtml(name) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  return renderIconStr(ws?.icon || "mdi-console", ws?.icon_color, 14);
}

function buildPreviewUrl(p) {
  // ユニークポート方式: any-console が target+20000 で TCP proxy を立てている。
  // proxy 証明書があれば scheme=https で TLS 終端、無ければ http。
  if (!p.proxy_port) return "";
  return `${p.scheme || "http"}://${location.hostname}:${p.proxy_port}/`;
}

function openPreview(p) {
  const url = buildPreviewUrl(p);
  if (!url) return;
  // iOS PWA モードでは <a target="_blank"> がループするため window.open を使う。
  // ユーザーインタラクション（click）から直接呼ぶのでポップアップブロックに引っかかりにくい。
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyUrl(p) {
  const url = buildPreviewUrl(p);
  await copyText(url);
  copiedPort.value = p.port;
  setTimeout(() => {
    if (copiedPort.value === p.port) copiedPort.value = null;
  }, 1500);
}

onMounted(async () => {
  await start();
  loading.value = false;
});

onUnmounted(() => {
  stop();
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
  font-size: 14px;
  font-family: monospace;
  color: var(--text-primary);
}
.preview-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.preview-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--accent);
}
.preview-label-none {
  color: var(--text-muted);
  opacity: 0.7;
}
.preview-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.preview-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  height: 36px;
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
  height: 36px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 16px;
  cursor: pointer;
}
.preview-proxy {
  color: var(--accent);
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
code {
  font-family: monospace;
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
