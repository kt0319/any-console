<template>
  <div class="modal-scroll-body">
    <div v-if="!infoPillConfig.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <label
        v-for="(item, idx) in orderedToggles"
        :key="item.field"
        class="settings-item settings-toggle pill-toggle-row"
        :class="{
          'drag-source': dragFromIdx === idx,
          'drag-over-above': dragOverIdx === idx && dragFromIdx > idx,
          'drag-over-below': dragOverIdx === idx && dragFromIdx < idx,
        }"
      >
        <span class="drag-handle" aria-hidden="true" @pointerdown.prevent="onDragStart($event, idx)">
          <span class="mdi mdi-drag-vertical"></span>
        </span>
        <input type="checkbox" :checked="infoPillConfig[item.field]" @change="setField(item.field, $event.target.checked)" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">{{ item.label }}</span>
          <span class="settings-note">{{ item.note }}</span>
        </div>
      </label>
    </template>
  </div>
</template>

<script setup>
import { inject, computed } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { useListDragSort } from "../composables/useListDragSort.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Info Pills";

const infoPillConfig = useInfoPillConfigStore();
if (!infoPillConfig.loaded) infoPillConfig.load();

// ラベルはピル本体のツールチップ文言（TerminalPane.vue）に揃える。
// 表示順は infoPillConfig.order（ドラッグハンドルで並び替え可能。
// ワークスペース一覧・Tabs & Sessionsと同じuseListDragSort）に従う。
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

const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".pill-toggle-row",
  onReorder: (fromIdx, toIdx) => infoPillConfig.reorder(fromIdx, toIdx),
});

function setField(field, value) {
  infoPillConfig[field] = value;
  infoPillConfig.save();
}
</script>

<style scoped>
/* .settings-toggle（settings-form.css）は justify-content:space-between の
   2要素（checkbox + copy）前提のため、先頭にdrag-handleを足すと間延びする。
   ここだけ通常の並び順（handle→checkbox→copy）に上書きする。 */
.pill-toggle-row {
  justify-content: flex-start;
}
</style>
