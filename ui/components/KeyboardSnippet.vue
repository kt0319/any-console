<template>
  <div class="quick-minimal-snippet-wrap" v-show="visible">
    <KeyboardChips />
  </div>
</template>

<script setup>
import { ref } from "vue";
import KeyboardChips from "./KeyboardChips.vue";

const visible = ref(false);

function show() { visible.value = true; }
function hide() { visible.value = false; }
function toggle() { visible.value = !visible.value; }

defineExpose({ show, hide, toggle, visible });
</script>
