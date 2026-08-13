<template>
  <div class="select-pane">
    <div class="textarea-scroll-wrapper">
      <textarea
        ref="textareaEl"
        class="terminal-select-textarea"
        :value="displayText"
        readonly
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
      ></textarea>
    </div>
    <div class="format-options">
      <label class="format-option format-option-all"><input type="checkbox" v-model="allChecked"> All formats</label>
      <label class="format-option"><input type="checkbox" v-model="format.stripLeading"> Strip leading spaces</label>
      <label class="format-option"><input type="checkbox" v-model="format.joinWrapped"> Join wrapped lines</label>
      <label class="format-option"><input type="checkbox" v-model="format.breakLines"> Break at punctuation</label>
      <label class="format-option"><input type="checkbox" v-model="format.tidy"> Tidy whitespace</label>
    </div>
    <button type="button" class="primary copy-full-btn" @mousedown.prevent @click="copySelection">
      <span class="mdi mdi-content-copy"></span> Copy
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { getFullBufferText } from "../utils/terminal-buffer-text.ts";
import { copyText } from "../utils/clipboard.ts";
import { applyFormat } from "../utils/auto-format.ts";
import { useToast } from "../composables/useToast.ts";

const FORMAT_KEYS = ["stripLeading", "joinWrapped", "breakLines", "tidy"] as const;

const terminalStore = useTerminalStore();
const toast = useToast();
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const original = ref("");

const format = reactive({ stripLeading: false, joinWrapped: false, breakLines: false, tidy: false });
const allChecked = computed({
  get: () => FORMAT_KEYS.every((k) => format[k]),
  set: (v) => { for (const k of FORMAT_KEYS) format[k] = v; },
});
const displayText = computed(() => applyFormat(original.value, format));

function refresh() {
  const tab = terminalStore.activeTab;
  original.value = tab ? (getFullBufferText(tab.term) || "") : "";
}

defineExpose({ refresh });

async function copySelection() {
  const el = textareaEl.value;
  const target = el && el.selectionStart !== el.selectionEnd
    ? el.value.slice(el.selectionStart, el.selectionEnd)
    : displayText.value;
  const ok = await copyText(target);
  if (ok) toast.success("Copied");
  else toast.error("Failed to copy");
}
</script>

<style scoped>
.select-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 8px;
  gap: 0;
}

.format-options {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  padding-top: 8px;
  flex-shrink: 0;
}

.copy-full-btn {
  width: auto;
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.copy-full-btn .mdi {
  font-size: 18px;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.format-option-all {
  width: 100%;
  font-weight: 600;
}

.format-option input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent, currentColor);
}

.textarea-scroll-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.terminal-select-textarea {
  width: 100%;
  height: 100%;
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
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}

.terminal-select-textarea::selection {
  background: var(--accent);
  color: var(--bg-primary);
}
</style>
