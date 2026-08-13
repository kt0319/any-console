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
import { computed } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.ts";
import { useListDragSort } from "../composables/useListDragSort.js";
import { INFO_PILLS } from "../utils/info-pills.ts";
import { useModalView } from "../composables/useModalView.js";

const { modalTitle } = useModalView();
modalTitle.value = "Info Pills";

const infoPillConfig = useInfoPillConfigStore();
if (!infoPillConfig.loaded) infoPillConfig.load();

// ラベル・説明はinfo-pills.jsのディスクリプタテーブルから導出する
// （文言はピル本体のツールチップに揃えてテーブル側で管理）。
// 表示順は infoPillConfig.order（ドラッグハンドルで並び替え可能。
// ワークスペース一覧・Sessions編集モードと同じuseListDragSort）に従う。
const TOGGLES = INFO_PILLS.map(({ key, label, note }) => ({ field: key, label, note }));

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
