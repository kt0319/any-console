<template>
  <div
    v-show="active"
    id="quick-input-panel"
    ref="panelEl"
    class="quick-input-panel minimal-mode"
    :class="{ 'snippet-open': snippetOpen }"
  >
    <div class="quick-key quick-flick-arrow quick-key-toggle" ref="arrowFlickEl">
      <span class="flick-hint-top">&uarr;</span>
      <span class="flick-hint-left">&larr;</span>
      <span class="flick-main"><span class="mdi mdi-keyboard"></span></span>
      <span class="flick-hint-right">&rarr;</span>
      <span class="flick-hint-bottom">&darr;</span>
    </div>

    <div class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle" ref="enterFlickEl">
      <span class="flick-hint-top">Tab</span>
      <span class="flick-hint-left">BS</span>
      <span class="flick-main">&crarr;</span>
      <span class="flick-hint-bottom">Space</span>
      <span class="flick-hint-right">Del</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";

const props = defineProps({
  active: { type: Boolean, default: false },
  snippetOpen: { type: Boolean, default: false },
});

const emit = defineEmits(["cycleMode"]);

const { sendKeyToTerminal, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const panelEl = ref(null);
const arrowFlickEl = ref(null);
const enterFlickEl = ref(null);


onMounted(() => {
  setupFlickRepeat(arrowFlickEl.value, arrowResolver, () => {
    const tab = getActiveTerminalTab();
    if (tab?.term) tab.term.scrollToBottom();
  }, {
    accelerateRepeat: true,
    onLongPress: () => emit("cycleMode"),
    longPressGuard: () => props.active,
  });

  setupFlickRepeat(enterFlickEl.value, enterResolver, () => {
    sendKeyToTerminal({ key: "Enter" });
  }, { accelerateRepeat: true });
});
</script>
