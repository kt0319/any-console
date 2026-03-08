<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="modal.close()"
  >
    <div ref="modalEl" class="modal">
      <div class="modal-header">
        <h3 class="modal-title">
          <slot name="title">{{ title }}</slot>
        </h3>
        <button type="button" class="modal-close-btn" @click="modal.close()">&times;</button>
      </div>
      <slot />
      <div v-if="$slots.actions" class="modal-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from "vue";
import { useModal } from "../composables/useModal.js";

const props = defineProps({
  title: { type: String, default: "" },
  swipeClose: { type: Boolean, default: false },
});

const modal = useModal();
const modalEl = ref(null);
let swipeSetup = false;

function open() {
  modal.open(modalEl.value, modal.close);
  nextTick(() => {
    if (props.swipeClose && modalEl.value && !swipeSetup) {
      modal.setupSwipeClose(modalEl.value, modal.close);
      swipeSetup = true;
    }
  });
}

watch(() => modal.visible.value, (val) => {
  if (val) {
    nextTick(() => {
      if (modalEl.value) {
        modal.close();
        modal.open(modalEl.value, modal.close);
        if (props.swipeClose && !swipeSetup) {
          modal.setupSwipeClose(modalEl.value, modal.close);
          swipeSetup = true;
        }
      }
    });
  }
}, { flush: "post" });

defineExpose({ open, close: modal.close, visible: modal.visible });
</script>
