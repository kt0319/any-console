<template>
  <div class="modal-scroll-body">
    <form class="snippet-add" @submit.prevent="onAdd">
      <input
        v-model="newCommand"
        class="snippet-input"
        type="text"
        placeholder="Add snippet..."
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
import { ref, computed } from "vue";
import { useInputStore } from "../stores/input.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useEmbeddedPanel } from "../composables/useEmbeddedPanel.js";

// embedded の意味・タイトル設定・閉じ方の切替えは useEmbeddedPanel.js 参照
// （SendHistory.vue と共通。circle keypadの"snippets"プリセット経由も
// embedded=false の設定モーダル表示）。
const props = defineProps({
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

const { closePanel } = useEmbeddedPanel({ embedded: props.embedded, title: "Send Snippet", emit });
const inputStore = useInputStore();

// snippetsCache は追加順（先頭が一番最初に追加＝最初に使ったもの）。
// 使用しても並び替えない（addSnippet が末尾へ push するだけ）。
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
  closePanel();
}
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

/* 一覧（.snippet-list / -row / -command / -delete / -empty）の見た目は
   ui/styles/command-list.css（グローバル）で SendHistory.vue と共用する。 */
</style>
