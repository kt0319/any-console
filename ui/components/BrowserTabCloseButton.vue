<template>
  <button type="button" class="pill-close-btn pill-tab-close-btn" aria-label="Close tab" data-tooltip="Close tab" @click="onClose">
    <span class="mdi mdi-close"></span>
  </button>
</template>

<script setup lang="ts">
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { confirmCloseBrowserTab } from "../utils/tab-close-confirm.ts";

// ブラウザタブの閉じるボタン（確認ダイアログ→closeBrowserTabまで込み）。
// BrowserPane.vue（フロートツールバー）とSessionListView.vue（サイドバー行）
// で同じマークアップ・挙動を共有する。配置はコンテキストごとに異なるため
// BrowserTabActionPillsには含めず独立コンポーネントにする。
const props = defineProps({
  tabId: { type: Number, required: true },
  label: { type: String, required: true },
});

const browserTabStore = useBrowserTabStore();
const { confirm } = useConfirm();

async function onClose(e: MouseEvent) {
  // サイドバー行では親要素のクリック（タブ選択）と重なるため伝播を止める。
  e.stopPropagation();
  const result = await confirmCloseBrowserTab(confirm, { label: props.label });
  if (result !== true) return;
  browserTabStore.closeBrowserTab(props.tabId);
}
</script>
