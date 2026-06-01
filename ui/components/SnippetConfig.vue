<template>
  <div class="modal-scroll-body">
    <form class="snippet-add" @submit.prevent="onAdd">
      <input
        v-model="newCommand"
        class="snippet-input"
        type="text"
        placeholder="Add command..."
      />
      <button type="submit" class="snippet-add-btn" :disabled="!newCommand.trim()" aria-label="Add snippet">
        <span class="mdi mdi-plus"></span>
      </button>
    </form>

    <div class="snippet-list" ref="listEl">
      <div
        v-for="(snippet, idx) in snippets"
        :key="idx"
        class="snippet-row"
        :class="{
          'drag-source': dragFromIdx === idx,
          'drag-over-above': dragOverIdx === idx && dragFromIdx > idx,
          'drag-over-below': dragOverIdx === idx && dragFromIdx < idx,
        }"
      >
        <span
          class="drag-handle"
          aria-hidden="true"
          @pointerdown.prevent="onDragStart($event, idx)"
        >
          <span class="mdi mdi-drag-vertical"></span>
        </span>
        <div class="snippet-command">{{ snippet.command }}</div>
        <button type="button" class="snippet-delete" @click="onDelete(idx)" aria-label="Delete snippet">
          <span class="mdi mdi-trash-can-outline"></span>
        </button>
      </div>
      <div v-if="snippets.length === 0" class="snippet-empty">No snippets</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from "vue";
import { useInputStore } from "../stores/input.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useListDragSort } from "../composables/useListDragSort.js";

const modalTitle = inject("modalTitle");
const inputStore = useInputStore();

const snippets = computed(() => inputStore.snippetsCache ? [...inputStore.snippetsCache].reverse() : []);

const newCommand = ref("");

function onAdd() {
  const command = newCommand.value.trim();
  if (!command) return;
  bridgeEmit("snippet:add", { command });
  newCommand.value = "";
}

function onDelete(reversedIdx) {
  const realIdx = inputStore.snippetsCache.length - 1 - reversedIdx;
  bridgeEmit("snippet:delete", { index: realIdx });
}

// スニペットは逆順表示のため fromIdx/toIdx を実ストレージ順に変換して送る
const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".snippet-row",
  onReorder: (from, to) => {
    const len = inputStore.snippetsCache.length;
    bridgeEmit("snippet:move", { from: len - 1 - from, to: len - 1 - to });
  },
});

onMounted(() => { modalTitle.value = "Snippets"; });
</script>

<style scoped>
.snippet-add {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.snippet-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}

.snippet-add-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.snippet-add-btn:disabled {
  border-color: var(--white-30);
  color: var(--white-30);
  cursor: not-allowed;
}

.snippet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.snippet-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: opacity 0.15s;
}


.snippet-command {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text-primary);
  word-break: break-all;
}

.snippet-delete {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
}

.snippet-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
