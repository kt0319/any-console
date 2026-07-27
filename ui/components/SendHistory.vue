<template>
  <div ref="scrollBodyEl" class="modal-scroll-body">
    <div class="history-list">
      <div v-for="(text, idx) in history" :key="idx" class="history-row">
        <button type="button" class="history-command" @click="onInsert(text)">{{ text }}</button>
        <button type="button" class="history-delete" @click="onDelete(text)" aria-label="Delete history entry">
          <span class="mdi mdi-trash-can-outline"></span>
        </button>
      </div>
      <div v-if="history.length === 0" class="history-empty">No history</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, nextTick } from "vue";
import { useInputStore } from "../stores/input.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
const inputStore = useInputStore();
const scrollBodyEl = ref(null);

// inputHistory は最新が先頭（unshift）。表示は古い→新しいの時系列順にし、
// 最後に追加された項目が一番下・かつ開いた時点でその位置までスクロール済みにする。
const history = computed(() => inputStore.inputHistory ? [...inputStore.inputHistory].reverse() : []);

function onDelete(text) {
  inputStore.removeInputHistory(text);
}

function onInsert(command) {
  bridgeEmit("keyboard:setDraft", { command });
  bridgeEmit("modal:close");
}

onMounted(async () => {
  modalTitle.value = "Send History";
  await nextTick();
  if (scrollBodyEl.value) scrollBodyEl.value.scrollTop = scrollBodyEl.value.scrollHeight;
});
</script>

<style scoped>
.history-list {
  display: flex;
  flex-direction: column;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.history-command {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  cursor: pointer;
}

.history-delete {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .history-delete:hover {
    color: var(--error);
  }
}

.history-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
