<template>
  <div class="modal-scroll-body">
    <div v-if="!infoPillConfig.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="settings-item">
        <span class="settings-item-label">Position</span>
        <span class="settings-note">Where the pill group is anchored on screen.</span>
        <div class="pill-position-radios">
          <label class="form-check-label"><input type="radio" :checked="infoPillConfig.position === 'top'" @change="infoPillConfig.setPosition('top')" /> Top</label>
          <label class="form-check-label"><input type="radio" :checked="infoPillConfig.position === 'bottom'" @change="infoPillConfig.setPosition('bottom')" /> Bottom</label>
        </div>
      </div>
      <label v-for="(item, idx) in orderedToggles" :key="item.field" class="settings-item settings-toggle">
        <input type="checkbox" :checked="infoPillConfig[item.field]" @change="setField(item.field, $event.target.checked)" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">{{ item.label }}</span>
          <span class="settings-note">{{ item.note }}</span>
        </div>
        <div class="pill-order-buttons">
          <button
            type="button"
            class="pill-order-btn"
            :disabled="idx === 0"
            aria-label="Move up"
            data-tooltip="Move up"
            @click="infoPillConfig.moveUp(item.field)"
          ><span class="mdi mdi-chevron-up"></span></button>
          <button
            type="button"
            class="pill-order-btn"
            :disabled="idx === orderedToggles.length - 1"
            aria-label="Move down"
            data-tooltip="Move down"
            @click="infoPillConfig.moveDown(item.field)"
          ><span class="mdi mdi-chevron-down"></span></button>
        </div>
      </label>
    </template>
  </div>
</template>

<script setup>
import { inject, computed } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Info Pills";

const infoPillConfig = useInfoPillConfigStore();
if (!infoPillConfig.loaded) infoPillConfig.load();

// ラベルはピル本体のツールチップ文言（TerminalPane.vue）に揃える。
// 表示順は infoPillConfig.order（上下ボタンで並び替え可能）に従う。
const TOGGLES = [
  { field: "files", label: "Files", note: "Show the files browser button." },
  { field: "history", label: "History", note: "Show the commit history button." },
  { field: "changes", label: "Changes", note: "Show the uncommitted changes button." },
  { field: "branch", label: "Branches", note: "Show the current branch button (includes pull/push when applicable)." },
  { field: "prs", label: "GitHub PRs", note: "Show the GitHub PR button when the current branch has an open pull request." },
  { field: "actions", label: "GitHub Actions", note: "Show the GitHub Actions run status button for the current branch." },
  { field: "devserver", label: "Dev Server", note: "Show the detected dev server button." },
  { field: "add", label: "Add / Open", note: "Show the add-or-open-workspace button for non-Git terminals." },
];

const orderedToggles = computed(() =>
  infoPillConfig.order.map((field) => TOGGLES.find((t) => t.field === field)).filter(Boolean),
);

function setField(field, value) {
  infoPillConfig[field] = value;
  infoPillConfig.save();
}
</script>

<style scoped>
.pill-order-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 0 0 auto;
}

.pill-order-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.pill-order-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

@media (hover: hover) and (pointer: fine) {
  .pill-order-btn:not(:disabled):hover {
    color: var(--text-primary);
  }
}

.pill-position-radios {
  display: flex;
  gap: 16px;
}
</style>
