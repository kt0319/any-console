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

    <div class="snippet-list">
      <div v-for="(snippet, idx) in snippets" :key="idx" class="snippet-row">
        <button type="button" class="snippet-command" @click="onInsert(snippet.command)">{{ snippet.command }}</button>
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

const modalTitle = inject("modalTitle");
const inputStore = useInputStore();

// snippetsCache は末尾が最終使用（addSnippet/moveSnippetToFront とも末尾へ push）。
// 逆順にせずそのまま表示することで、最終使用が一番下に来る。
const snippets = computed(() => inputStore.snippetsCache ? [...inputStore.snippetsCache] : []);

const newCommand = ref("");

function onAdd() {
  const command = newCommand.value.trim();
  if (!command) return;
  bridgeEmit("snippet:add", { command });
  newCommand.value = "";
}

function onDelete(idx) {
  bridgeEmit("snippet:delete", { index: idx });
}

function onInsert(command) {
  bridgeEmit("keyboard:setDraft", { command });
  bridgeEmit("snippet:use", { command });
  bridgeEmit("modal:close");
}

onMounted(() => { modalTitle.value = "Send Snippet"; });
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
}

.snippet-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.snippet-command {
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

.snippet-delete {
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
  .snippet-delete:hover {
    color: var(--error);
  }
}

.snippet-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
