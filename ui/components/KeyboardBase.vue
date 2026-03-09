<template>
  <KeyboardMinimumKey
    :active="mode === 0"
    :snippet-open="snippetOpen"
    @cycleMode="cycleMode"
  />
  <KeyboardQwertyKey
    :active="mode === 1"
    @cycleMode="cycleMode"
  />
</template>

<script setup>
import { ref, watch, nextTick } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { emit } from "../app-bridge.js";
import KeyboardMinimumKey from "./KeyboardMinimumKey.vue";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";

const { clearModifiers } = useKeyboard();

const mode = ref(0);
const snippetOpen = ref(false);

function cycleMode() {
  mode.value = (mode.value + 1) % 2;
  clearModifiers();
}

watch(mode, (val) => {
  nextTick(() => {
    emit("layout:fitAll");
    emit("keyboard:modeChange", { mode: val });
  });
});

defineExpose({ mode, cycleMode, snippetOpen });
</script>
