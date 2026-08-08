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
import { ref, computed, onMounted, nextTick } from "vue";
import { useInputStore } from "../stores/input.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useEmbeddedPanel } from "../composables/useEmbeddedPanel.js";

// embedded の意味・タイトル設定・閉じ方の切替えは useEmbeddedPanel.js 参照
// （SendSnippet.vue と共通）。
const props = defineProps({
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

const { closePanel } = useEmbeddedPanel({ embedded: props.embedded, title: "Send History", emit });
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
  closePanel();
}

onMounted(async () => {
  await nextTick();
  if (scrollBodyEl.value) scrollBodyEl.value.scrollTop = scrollBodyEl.value.scrollHeight;
});
</script>

<!-- 一覧の見た目は ui/styles/command-list.css（グローバル）で
     SendSnippet.vue と共用する。 -->
