<template>
  <template v-if="isPanelBottom">
    <div v-if="mode === 1" class="keyboard-qwerty-overlay" @click="switchToMinimum"></div>
    <div v-show="!isTextInputVisible">
      <KeyboardMinimumKey
        :active="mode === 0"
        :snippet-open="snippetOpen"
        @cycleMode="cycleMode"
      />
      <KeyboardQwertyKey
        :active="mode === 1"
        @cycleMode="cycleMode"
      />
    </div>
    <KeyboardInput
      ref="keyboardInputBar"
      @visibility="onKeyboardInputVisibility"
    />
  </template>
</template>

<script setup>
import { ref, watch, nextTick } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { emit } from "../app-bridge.js";
import KeyboardMinimumKey from "./KeyboardMinimumKey.vue";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";

defineProps({
  isPanelBottom: { type: Boolean, default: false },
});
const emitLocal = defineEmits(["visibility"]);

const { clearModifiers } = useKeyboard();

const mode = ref(0);
const snippetOpen = ref(false);
const keyboardInputBar = ref(null);
const isTextInputVisible = ref(false);

function cycleMode() {
  mode.value = (mode.value + 1) % 2;
  clearModifiers();
}

function switchToMinimum() {
  mode.value = 0;
  clearModifiers();
}

function onKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
  emitLocal("visibility", isTextInputVisible.value);
}

function showInput() {
  keyboardInputBar.value?.show?.();
}

function hideInput() {
  keyboardInputBar.value?.hide?.();
}

watch(mode, (val) => {
  nextTick(() => {
    emit("layout:fitAll");
    emit("keyboard:modeChange", { mode: val });
  });
});

defineExpose({
  mode,
  cycleMode,
  switchToMinimum,
  snippetOpen,
  keyboardInputBar,
  isTextInputVisible,
  showInput,
  hideInput,
});
</script>
