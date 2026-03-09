<template>
  <div v-if="visible">
    <div class="keyboard-input-overlay" @click="hide"></div>
    <div class="keyboard-input-wrapper quick-input">
      <div class="keyboard-input-snippets">
        <div class="quick-snippet-scroll-row">
          <button
            v-for="(snippet, idx) in snippets"
            :key="'s-' + idx"
            type="button"
            class="quick-snippet-item"
            @click="insertText(snippet.command)"
          >
            <span class="mdi mdi-pin snippet-chip-icon"></span>
            {{ truncate(snippet.label) }}
          </button>
          <div v-if="snippets.length === 0" class="quick-snippet-item quick-snippet-item-empty">スニペットなし</div>
        </div>
        <div class="quick-snippet-scroll-row">
          <button
            v-for="(text, idx) in history"
            :key="'h-' + idx"
            type="button"
            class="quick-snippet-item"
            @click="insertText(text)"
          >
            <span class="mdi mdi-history snippet-chip-icon"></span>
            {{ truncate(text) }}
          </button>
          <div v-if="history.length === 0" class="quick-snippet-item quick-snippet-item-empty">履歴なし</div>
        </div>
      </div>
      <div class="keyboard-input-row">
        <input
          ref="inputEl"
          v-model="draft"
          class="keyboard-input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
        spellcheck="false"
        placeholder="テキスト入力..."
        @keydown.enter.prevent="submit"
        @blur="onInputBlur"
      />
        <button type="button" class="keyboard-input-send" :disabled="!draft.trim()" @click="submit">
          <span class="mdi mdi-send"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const emitLocal = defineEmits(["visibility"]);

const inputStore = useInputStore();
const { sendTextToTerminal } = useKeyboard();

const visible = ref(false);
const draft = ref("");
const inputEl = ref(null);

const snippets = computed(() => inputStore.snippetsCache ? [...inputStore.snippetsCache].reverse() : []);
const history = computed(() => inputStore.inputHistory ? [...inputStore.inputHistory] : []);

function truncate(text) {
  return text && text.length > 20 ? text.slice(0, 20) + "\u2026" : text || "";
}

function show() {
  visible.value = true;
  emitLocal("visibility", true);
  nextTick(() => inputEl.value?.focus());
}

function hide() {
  visible.value = false;
  emitLocal("visibility", false);
}

function onInputBlur() {
  // iOSでソフトキーボードを閉じた時はinputがblurするため、入力モードも閉じる
  if (visible.value) hide();
}

function insertText(text) {
  if (!text) return;
  draft.value = draft.value ? `${draft.value} ${text}` : text;
  nextTick(() => inputEl.value?.focus());
}

function submit() {
  const text = draft.value.trim();
  if (!text) return;
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  bridgeEmit("layout:fitAll");
  draft.value = "";
  hide();
}

defineExpose({ show, hide, visible, draft });
</script>
