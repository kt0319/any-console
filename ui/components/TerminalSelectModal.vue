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
      <button type="button" class="primary copy-full-btn" @mousedown.prevent @click="copySelection">
        <span class="mdi mdi-content-copy"></span> Copy
      </button>
      <div class="format-options">
        <label class="format-option format-option-all"><input type="checkbox" v-model="allChecked"> All formats</label>
        <label class="format-option"><input type="checkbox" v-model="format.stripLeading"> Strip leading spaces</label>
        <label class="format-option"><input type="checkbox" v-model="format.joinWrapped"> Join wrapped lines</label>
        <label class="format-option"><input type="checkbox" v-model="format.breakLines"> Break at punctuation</label>
        <label class="format-option"><input type="checkbox" v-model="format.tidy"> Tidy whitespace</label>
      </div>
      <div class="modal-body">
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
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { on, emit } from "../app-bridge.js";
import { getFullBufferText } from "../utils/terminal-buffer-text.js";
import { copyText } from "../utils/clipboard.js";
import { applyFormat } from "../utils/auto-format.js";

const FORMAT_KEYS = ["stripLeading", "joinWrapped", "breakLines", "tidy"];

const visible = ref(false);
const original = ref("");
const textareaEl = ref(null);

// 整形は非破壊。チェックを全部外せば原文に戻る。
const format = reactive({ stripLeading: false, joinWrapped: false, breakLines: false, tidy: false });
// 親チェック: 全項目 on のとき on。切り替えで全項目を一括 on/off する。
const allChecked = computed({
  get: () => FORMAT_KEYS.every((k) => format[k]),
  set: (v) => { for (const k of FORMAT_KEYS) format[k] = v; },
});
const displayText = computed(() => applyFormat(original.value, format));

function open(payload) {
  original.value = payload?.text || getFullBufferText(payload?.tab?.term) || payload?.fallbackText || "";
  for (const k of FORMAT_KEYS) format[k] = false;
  visible.value = true;
}

function close() {
  visible.value = false;
}

// textarea で範囲選択中ならその部分を、無ければ全文（整形後）をクリップボードへコピーする。
async function copySelection() {
  const el = textareaEl.value;
  const target = el && el.selectionStart !== el.selectionEnd
    ? el.value.slice(el.selectionStart, el.selectionEnd)
    : displayText.value;
  const ok = await copyText(target);
  emit("toast:show", ok
    ? { message: "Copied", type: "success" }
    : { message: "Failed to copy", type: "error" });
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

/* base.css の button.primary を踏襲。アイコン中央寄せと左右マージンのみ調整 */
.copy-full-btn {
  width: auto;
  margin: 0 8px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.copy-full-btn .mdi {
  font-size: 18px;
}

.format-options {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  padding: 0 8px 8px;
  flex-shrink: 0;
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

/* 親チェックは 1 行占有して個別項目と段を分ける */
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

/* close をヘッダ右端へ寄せる */
.modal-close-btn {
  margin-left: auto;
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
