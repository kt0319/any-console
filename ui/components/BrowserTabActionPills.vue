<template>
  <button type="button" class="pill-chip pill-devserver-btn" aria-label="Edit URL" data-tooltip="Edit URL" @click="onEditUrl">
    <span class="mdi mdi-web"></span>
  </button>
  <button type="button" class="pill-chip pill-devserver-btn" aria-label="Reload" data-tooltip="Reload" @click="browserTabStore.reloadBrowserTab(id)">
    <span class="mdi mdi-refresh"></span>
  </button>
  <button type="button" class="pill-chip pill-devserver-btn" aria-label="Open in new tab" data-tooltip="Open in new tab" @click="onOpenExternal">
    <span class="mdi mdi-open-in-new"></span>
  </button>
</template>

<script setup lang="ts">
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { usePrompt } from "../composables/usePrompt.ts";
import { openExternal } from "../utils/open-external.ts";

// ブラウザタブ（dev serverプレビュー）共通のEdit URL/Reload/Open in new tab
// ピル群。BrowserPane.vue（フロートするInfo Pill風ツールバー）と
// SessionListView.vue（サイドバーのブラウザタブ行）の両方から同じ見た目・
// 挙動で使うため、マークアップとURL編集ロジックをここに集約する。
// Close（閉じる）ボタンは配置がコンテキストごとに異なる（フロートツールバー
// では同じ並びの一員、サイドバーでは.session-sidebar-pillsの外の兄弟）ため
// 対象外とし、呼び出し側にそのまま残す。
const props = defineProps({
  id: { type: Number, required: true },
  url: { type: String, required: true },
});

const browserTabStore = useBrowserTabStore();
const { prompt } = usePrompt();

async function onEditUrl() {
  const next = await prompt({
    title: "Edit URL",
    initialValue: props.url,
    placeholder: "https://example.com",
    confirmLabel: "Go",
  });
  if (!next || next === props.url) return;
  browserTabStore.updateBrowserTabUrl(props.id, next);
}

// 外部の通常ブラウザで開くと同時に、このブラウザタブもアクティブにする
// （サイドバーの非アクティブなブラウザタブ行から押した時、外部ブラウザから
// 戻ってきたらこのタブを見ている状態にしておくため）。
function onOpenExternal() {
  openExternal(props.url);
  browserTabStore.selectBrowserTab(props.id);
}
</script>
