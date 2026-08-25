<template>
  <button
    type="button"
    class="tab-btn browser-tab-btn hover-bg"
    :class="{ active: isActive, 'tab-working': tab.loading, 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isActive, 'tab-underline-top': isPanelBottom }"
    :aria-label="tab.label"
    :aria-selected="isActive ? 'true' : 'false'"
    role="tab"
    :tabindex="isActive ? 0 : -1"
    @click="onClick"
  >
    <span class="tab-icon-slot browser-tab-icon" v-html="iconHtml"></span>
    <span class="tab-extra">{{ tab.label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, type PropType } from "vue";
import type { BrowserTab } from "../stores/browserTabs.ts";
import { renderIconStr } from "../utils/render-icon.ts";

const props = defineProps({
  tab: { type: Object as PropType<BrowserTab>, required: true },
  activeBrowserTabId: { type: Number as PropType<number | null>, default: null },
  isPanelBottom: { type: Boolean, default: false },
});

const emits = defineEmits(["select"]);

const isActive = computed(() => props.activeBrowserTabId === props.tab.id);
// ワークスペースとは紐付けない（dev serverプレビュー用の単なるURLタブ）ため、
// アイコンは常に地球儀固定。
const iconHtml = computed(() => renderIconStr("mdi-web", null, 18));

function onClick() {
  if (!isActive.value) emits("select", props.tab);
}
</script>

<style scoped>
/* タブピルの基本の見た目（.tab-btn / .tab-icon-slot / .tab-extra / .tab-close /
   モバイルでの畳み方）は TabItem.vue と共有するため ui/styles/tab-item.css
   （グローバル）にある。ここにはブラウザタブ固有の分だけを置く。 */

/* renderIconStrの色指定はhexのみ対応（CSS変数は正規表現で弾かれる）ため、
   ここでクラス経由であてる。ブラウザタブ関連のアイコンは濃い青
   （BrowserTabActionPills.vueのEdit URLアイコンと同じ）に揃える。 */
.browser-tab-icon :deep(.mdi) {
  color: var(--blue);
}
</style>
