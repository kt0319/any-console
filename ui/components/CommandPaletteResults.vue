<template>
  <div class="modal-scroll-body command-palette-results">
    <div id="command-palette-list" class="command-palette-list" :class="{ 'from-bottom': fromBottom }" role="listbox" aria-label="Results">
      <div
        v-for="(item, index) in results"
        :id="optionId(index)"
        :key="item.id"
        class="command-palette-item hover-bg"
        :class="{ active: index === activeIndex }"
        role="option"
        :aria-selected="index === activeIndex"
        @click="$emit('select', item)"
      >
        <span class="command-palette-item-icons" aria-hidden="true" v-html="iconsHtml(item)"></span>
        <span class="command-palette-item-label">{{ item.label }}</span>
        <span class="command-palette-item-group">{{ item.group }}</span>
      </div>
      <div v-if="!results.length" class="command-palette-empty" role="status">No matches</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, watch } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { commandPaletteOptionId as optionId } from "../utils/command-palette.ts";
import type { PaletteItem } from "../utils/command-palette.ts";

// セッションサイドバーの検索入力（SessionListPanel.vue）に対する結果リスト。
// 選択位置・実行は親が持ち、ここは表示と click の通知だけを担う。
const props = defineProps<{
  results: PaletteItem[],
  activeIndex: number,
  // 下端（検索入力の側）から積む。先頭の候補が一番下に来る。
  fromBottom?: boolean,
}>();
defineEmits<{ select: [item: PaletteItem] }>();

function iconsHtml(item: PaletteItem) {
  return item.icons.map((icon) => renderIconStr(icon.name, icon.color, 16)).join("");
}

watch(() => props.activeIndex, async (index) => {
  await nextTick();
  document.getElementById(optionId(index))?.scrollIntoView?.({ block: "nearest" });
});
</script>

<style scoped>
.command-palette-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.command-palette-list.from-bottom {
  flex-direction: column-reverse;
  margin-top: auto;
}

.command-palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.command-palette-item.active {
  background: var(--accent-bg-12);
  color: var(--text-primary);
}

.command-palette-item-icons {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 20px;
  color: var(--text-muted);
}

.command-palette-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.command-palette-item-group {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.command-palette-empty {
  padding: 12px 10px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
