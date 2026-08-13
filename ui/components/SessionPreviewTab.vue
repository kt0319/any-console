<template>
  <div class="preview-tab">
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
        <div class="preview-port-row">
          <span class="preview-port">
            :{{ p.port }}
            <span v-if="p.proxy_port" class="preview-proxy"> → :{{ p.proxy_port }}</span>
          </span>
          <span v-if="p.is_self" class="preview-self">this console</span>
        </div>
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { copyText } from "../utils/clipboard.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { usePreviewPorts } from "../composables/usePreviewPorts.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { devServerUrl } from "../utils/preview-url.ts";
import { openExternal } from "../utils/open-external.ts";
import { useModalView } from "../composables/useModalView.ts";

// Settings（ModalMenu）の「Dev Server」項目から開くcurrentView
// （'SessionPreview'）。旧PreviewPorts.vue（ModalMenu配下の独立画面）から
// 移植したもの。ポーリングはこのコンポーネント自身のマウント/アンマウントに
// 紐付ける（usePreviewPortsはref-counted共有composableのため、TerminalPaneの
// 他の利用と重複起動にはならない）。

const { modalTitle } = useModalView();
modalTitle!.value = "Dev Server";

const { ports, start: startPolling, stop: stopPolling } = usePreviewPorts();
onMounted(startPolling);
onBeforeUnmount(stopPolling);

const workspaceStore = useWorkspaceStore();
const copiedPort = ref<number | null>(null);
const hostname = location.hostname;

function workspaceIconHtml(name) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  return renderIconStr(ws?.icon || "mdi-console", ws?.icon_color, 14);
}

function buildPreviewUrl(p) {
  return devServerUrl(p, location.hostname);
}

function openPreview(p) {
  const url = buildPreviewUrl(p);
  if (!url) return;
  // iOS PWA モードでは <a target="_blank"> がループするため window.open 版（openExternal）を使う。
  // ユーザーインタラクション（click）から直接呼ぶのでポップアップブロックに引っかかりにくい。
  openExternal(url);
}

async function copyUrl(p) {
  const url = buildPreviewUrl(p);
  await copyText(url);
  copiedPort.value = p.port;
  setTimeout(() => {
    if (copiedPort.value === p.port) copiedPort.value = null;
  }, 1500);
}
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
.preview-port-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
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
