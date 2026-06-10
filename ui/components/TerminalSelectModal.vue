<template>
  <div
    v-if="visible"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="close"
  >
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap no-back" tabindex="-1" aria-disabled="true">
          <h3 class="modal-title">Select &amp; Copy</h3>
        </div>
        <button type="button" class="modal-close-btn" @click="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="textarea-scroll-wrapper">
          <textarea
            ref="textareaEl"
            class="terminal-select-textarea"
            :value="text"
            readonly
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { on } from "../app-bridge.js";
import { getFullBufferText } from "../utils/terminal-buffer-text.js";

const visible = ref(false);
const text = ref("");
const textareaEl = ref(null);

function open(payload) {
  text.value = payload?.text || getFullBufferText(payload?.tab?.term) || payload?.fallbackText || "";
  visible.value = true;
}

function close() {
  visible.value = false;
}

let offSelectionOpen = null;
onMounted(() => {
  offSelectionOpen = on("selection:open", (payload) => open(payload));
});
onBeforeUnmount(() => { offSelectionOpen?.(); });
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}

.modal {
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 8px 0;
  width: 100%;
  max-width: 96vw;
  height: calc(var(--app-dvh) * 0.8);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  justify-content: flex-start;
}

.modal-title-wrap .modal-title {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  text-align: left;
}

.modal-body {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 8px 8px;
}

.modal-close-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
  margin-left: auto;
  padding: 0;
  font-size: 22px;
  line-height: 1;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
}

.textarea-scroll-wrapper {
  position: absolute;
  inset: 0;
  overflow-y: scroll;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.terminal-select-textarea {
  width: 100%;
  min-height: 100%;
  resize: none;
  padding: 12px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: none;
  outline: none;
  font-family: "Hack Nerd Font", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}

.terminal-select-textarea::selection {
  background: var(--accent);
  color: var(--bg-primary);
}

@media (min-width: 900px) {
  .modal-overlay {
    padding: 28px;
  }

  .modal {
    max-width: min(900px, 90vw);
    height: calc(var(--app-dvh) * 0.84);
  }
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-start;
  }

  .modal {
    max-width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
    flex-direction: column-reverse;
  }

  .modal-header {
    border-bottom: none;
    border-top: 1px solid var(--border);
    margin-bottom: 0;
    margin-top: 8px;
    padding-bottom: calc(env(safe-area-inset-bottom) + 22px);
  }
}
</style>
