<template>
  <div class="modal-scroll-body">
    <div class="history-list">
      <div v-for="(text, idx) in history" :key="idx" class="history-row">
        <button type="button" class="history-command" @click="onInsert(text)">{{ text }}</button>
        <button type="button" class="history-delete" @click="onDelete(text)" aria-label="Delete history entry" data-tooltip="Delete history entry">
          <span class="mdi mdi-trash-can-outline"></span>
        </button>
      </div>
      <div v-if="history.length === 0" class="history-empty">No history</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useInputStore } from "../stores/input.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { useEmbeddedPanel } from "../composables/useEmbeddedPanel.ts";

const props = defineProps({
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

const { closePanel } = useEmbeddedPanel({ embedded: props.embedded, title: "Send History", emit });
const inputStore = useInputStore();

// inputHistory は最新が先頭（unshift）。そのまま表示して最新をスクロール初期位置に出す
const history = computed(() => inputStore.inputHistory ?? []);

function onDelete(text: string) {
  inputStore.removeInputHistory(text);
}

function onInsert(command: string) {
  bridgeEmit("keyboard:setDraft", { command });
  closePanel();
}
</script>

