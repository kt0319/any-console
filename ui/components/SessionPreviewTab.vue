<template>
  <div class="preview-tab">
    <div class="settings-item-desc">
      Detected local dev servers on <code>{{ hostname }}</code>.
    </div>
    <div v-if="!ports.length" class="settings-item-desc">
      No ports detected yet. Start a dev server (e.g. <code>npm run dev</code>) in a terminal.
    </div>
    <div v-for="p in ports" :key="p.port" class="preview-row">
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
        <button type="button" class="preview-open" @click="openPreview(p)">
          <span class="mdi mdi-open-in-new"></span> Open
        </button>
        <button
          v-if="p.pid"
          type="button"
          class="preview-kill commit-action-danger"
          :class="{ running: killingPids.has(p.pid) }"
          :disabled="killingPids.has(p.pid)"
          aria-label="Kill process"
          data-tooltip="Kill process"
          @click="killDevServer(p)"
        >
          <span class="mdi mdi-close"></span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { usePreviewPorts } from "../composables/usePreviewPorts.ts";
import { useDevServerOpen } from "../composables/useDevServerOpen.ts";
import { useProcessKill } from "../composables/useProcessKill.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { useModalView } from "../composables/useModalView.ts";

// Settings（ModalMenu）の「Dev Server」項目から開くcurrentView
// （'SessionPreview'）。旧PreviewPorts.vue（ModalMenu配下の独立画面）から
// 移植したもの。ポーリングはこのコンポーネント自身のマウント/アンマウントに
// 紐付ける（usePreviewPortsはref-counted共有composableのため、TerminalPaneの
// 他の利用と重複起動にはならない）。

const { modalTitle } = useModalView();
modalTitle!.value = "Dev Server";

const { ports, start: startPolling, stop: stopPolling, fetchPorts } = usePreviewPorts();
onMounted(startPolling);
onBeforeUnmount(stopPolling);

const workspaceStore = useWorkspaceStore();
const { confirmOpenDevServer } = useDevServerOpen();
const { killingPids, killProcess } = useProcessKill();
const hostname = location.hostname;

function workspaceIconHtml(name) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  return renderIconStr(ws?.icon || "mdi-console", ws?.icon_color, 14);
}

// Server pill（TerminalPane）と同じOpen/Copy選択の確認フローにする
// （直接開かず、URLだけ確認・コピーもできるようにする）。
async function openPreview(p) {
  await confirmOpenDevServer(p);
}

function killDevServer(p) {
  return killProcess(p.pid, {
    confirmMessage: `Kill process ${p.pid} (${p.process}, port ${p.port})? This sends SIGTERM.`,
    refetch: fetchPorts,
    isGone: () => !ports.value.some((port) => port.pid === p.pid),
  });
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
/* color/border-colorは.commit-action-danger（base.css）が担う。ここでは
   border style/widthのみ指定し、色は指定しない（currentColorでcolorに追従）。 */
.preview-kill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  border: 1px solid;
  border-radius: var(--radius);
  font-size: 16px;
  cursor: pointer;
}

/* GitActionBtn.vueのrunning状態と同じ表現（アイコンを隠しスピナーを出す）。 */
.preview-kill.running {
  pointer-events: none;
  color: transparent;
}

.preview-kill.running > * {
  visibility: hidden;
}

.preview-kill.running::after {
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
