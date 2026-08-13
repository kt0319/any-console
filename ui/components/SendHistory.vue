<template>
  <div class="modal-scroll-body">
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

<script setup lang="ts">
import { computed } from "vue";
import { useInputStore } from "../stores/input.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { useEmbeddedPanel } from "../composables/useEmbeddedPanel.ts";

// embedded の意味・タイトル設定・閉じ方の切替えは useEmbeddedPanel.js 参照
// （SendSnippet.vue と共通）。
const props = defineProps({
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

const { closePanel } = useEmbeddedPanel({ embedded: props.embedded, title: "Send History", emit });
const inputStore = useInputStore();

// inputHistory は最新が先頭（unshift）。表示もそのまま最新→古いの順にし、
// 一番上（スクロール初期位置）に最新の項目が来るようにする。
const history = computed(() => inputStore.inputHistory ?? []);

function onDelete(text) {
  inputStore.removeInputHistory(text);
}

function onInsert(command) {
  bridgeEmit("keyboard:setDraft", { command });
  closePanel();
}
</script>

<!-- 一覧の見た目は ui/styles/command-list.css（グローバル）で
     SendSnippet.vue と共用する。 -->
