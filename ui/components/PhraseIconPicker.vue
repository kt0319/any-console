<template>
  <div class="phrase-icon-picker">
    <div class="phrase-icon-grid">
      <button
        v-for="opt in iconOptions"
        :key="opt.icon"
        type="button"
        class="phrase-icon-option"
        :class="[opt.className, { selected: opt.icon === selectedIcon }]"
        :data-tooltip="opt.icon"
        @click="select(opt.icon)"
      >
        <span class="mdi" :class="opt.icon" aria-hidden="true"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useModalView } from "../composables/useModalView.js";

const { modalTitle, viewState, popView } = useModalView();
modalTitle.value = "Pick Icon";

const iconOptions = viewState.value.iconOptions || [];
const selectedIcon = ref(viewState.value.currentIcon || "");

function select(icon) {
  popView({ icon });
}
</script>

<style scoped>
.phrase-icon-picker {
  padding: 16px;
}

.phrase-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.phrase-icon-option {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: background 0.1s;
}

.phrase-icon-option.selected {
  border-color: var(--accent);
  background: var(--bg-tertiary);
}

@media (hover: hover) and (pointer: fine) {
  .phrase-icon-option:hover {
    background: var(--bg-secondary);
  }
}

.phrase-icon-option.agent-state-blocked { color: var(--error); }
.phrase-icon-option.agent-state-select { color: #f5a623; }
.phrase-icon-option.agent-state-done { color: var(--success); }
.phrase-icon-option.agent-state-custom { color: var(--accent); }
</style>
