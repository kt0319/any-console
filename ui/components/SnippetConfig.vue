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
          'is-dragging': dragState?.fromIdx === idx,
          'drop-before': dragState?.overIdx === idx && dragState.overIdx < dragState.fromIdx,
          'drop-after': dragState?.overIdx === idx && dragState.overIdx > dragState.fromIdx,
        }"
      >
        <div
          class="snippet-drag-handle"
          @pointerdown="onDragStart($event, idx)"
          aria-label="Drag to reorder"
        >
          <span class="mdi mdi-drag-vertical"></span>
        </div>
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

const modalTitle = inject("modalTitle");
const inputStore = useInputStore();

const snippets = computed(() => inputStore.snippetsCache ? [...inputStore.snippetsCache].reverse() : []);

const newCommand = ref("");
const listEl = ref(null);
const dragState = ref(null);

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

function onDragStart(e, fromIdx) {
  e.preventDefault();
  dragState.value = { fromIdx, overIdx: fromIdx };

  function getOverIdx(clientY) {
    if (!listEl.value) return fromIdx;
    const rows = listEl.value.querySelectorAll(".snippet-row");
    let closest = fromIdx;
    let minDist = Infinity;
    rows.forEach((row, i) => {
      const rect = row.getBoundingClientRect();
      const dist = Math.abs(clientY - (rect.top + rect.height / 2));
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    return closest;
  }

  function onMove(ev) {
    const clientY = ev.clientY ?? ev.touches?.[0]?.clientY;
    if (clientY == null) return;
    dragState.value = { ...dragState.value, overIdx: getOverIdx(clientY) };
  }

  function onEnd(ev) {
    const { fromIdx: from, overIdx: over } = dragState.value;
    if (from !== over) {
      const len = inputStore.snippetsCache.length;
      bridgeEmit("snippet:move", { from: len - 1 - from, to: len - 1 - over });
    }
    dragState.value = null;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onEnd);
    document.removeEventListener("pointercancel", onEnd);
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onEnd);
  document.addEventListener("pointercancel", onEnd);
}

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

.snippet-row.is-dragging {
  opacity: 0.4;
}

.snippet-row.drop-before {
  border-top: 2px solid var(--accent);
}

.snippet-row.drop-after {
  border-bottom: 2px solid var(--accent);
}

.snippet-drag-handle {
  flex-shrink: 0;
  width: 28px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: grab;
  touch-action: none;
  font-size: 18px;
}

.snippet-drag-handle:active {
  cursor: grabbing;
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
