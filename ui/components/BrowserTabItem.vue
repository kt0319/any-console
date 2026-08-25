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
    <span v-if="wsIconHtml" class="tab-icon-slot" v-html="wsIconHtml"></span>
    <span class="tab-icon-slot browser-tab-server-icon" v-html="serverIconHtml"></span>
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
// 開いた元のdev serverのワークスペースアイコンと、devserver InfoPillと同じ
// serverアイコン（mdi-server）を並べて表示する。ワークスペースが無ければ
// serverアイコンだけになる。
const wsIconHtml = computed(() => (props.tab.icon ? renderIconStr(props.tab.icon, props.tab.iconColor, 18) : ""));
const serverIconHtml = computed(() => renderIconStr("mdi-server", null, 18));

function onClick() {
  if (!isActive.value) emits("select", props.tab);
}
</script>

<style scoped>
/* タブピルの基本の見た目（.tab-btn / .tab-icon-slot / .tab-extra / .tab-close /
   モバイルでの畳み方）は TabItem.vue と共有するため ui/styles/tab-item.css
   （グローバル）にある。ここにはブラウザタブ固有の分だけを置く。 */

/* InfoPillのDev Serverピル（.pill-server-btn .mdi）と同じ色に揃える。
   renderIconStrの色指定はhexのみ対応（CSS変数は正規表現で弾かれる）ため、
   ここでクラス経由であてる。 */
.browser-tab-server-icon :deep(.mdi) {
  color: var(--lime);
}
</style>
