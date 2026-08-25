<template>
  <div class="browser-pane">
    <div class="browser-pane-body">
      <div class="pill-group" :class="{ 'pill-group-bottom': layoutStore.isPanelBottom }">
        <BrowserTabActionPills :id="tabId" :url="url" />
        <button type="button" class="pill-close-btn pill-tab-close-btn" aria-label="Close tab" data-tooltip="Close tab" @click="onClose">
          <span class="mdi mdi-close"></span>
        </button>
      </div>
      <iframe
        :key="reloadKey"
        class="browser-pane-frame"
        :src="url"
        :title="`Browser tab: ${url}`"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        referrerpolicy="no-referrer"
        @load="onLoad"
      ></iframe>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { useLayoutStore } from "../stores/layout.ts";
import BrowserTabActionPills from "./BrowserTabActionPills.vue";

const props = defineProps({
  url: { type: String, required: true },
  tabId: { type: Number, required: true },
});

const browserTabStore = useBrowserTabStore();
const layoutStore = useLayoutStore();

// :key に使い、値を変えるとiframe要素ごと作り直して強制的に再読み込みさせる。
const reloadKey = ref(0);

function onReload() {
  browserTabStore.setBrowserTabLoading(props.tabId, true);
  // contentWindow.location.reload() はcross-origin iframeから呼べる想定
  // だったが、実機（モバイルSafari含む）では例外を投げずに何もせず
  // 無視されるケースがあり、その場合catchが働かず永久に真っ白のまま
  // 固まってしまっていた。iframe要素ごと作り直す（:keyを変える）方式は
  // contentWindowへ触れないため確実に効き、この方式一本にする。
  reloadKey.value += 1;
}

// iframeのナビゲーションが完了した合図。X-Frame-Options等でフレーム先の
// 読み込み自体が拒否された場合もiframe要素自体のloadは発火するため、
// working演出が固まったままになる心配は無い。
function onLoad() {
  browserTabStore.setBrowserTabLoading(props.tabId, false);
}

function onClose() {
  browserTabStore.closeBrowserTab(props.tabId);
}

// v-show でパネル自体は非アクティブ時も常時マウントされたままのため、
// サイドバー（SessionListView.vue）等、このコンポーネント外からでも
// reloadBrowserTab(tabId) 経由で同じReloadを呼べるよう登録しておく。
onMounted(() => browserTabStore.registerReloadHandler(props.tabId, onReload));
onBeforeUnmount(() => browserTabStore.unregisterReloadHandler(props.tabId));

// urlが変わるたび（Edit URLでの書き換え含む、マウント直後の初回ナビゲーション
// も含む）working演出を開始する。onLoadで完了に戻す。
watch(() => props.url, () => browserTabStore.setBrowserTabLoading(props.tabId, true), { immediate: true });
</script>

<style scoped>
.browser-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ピル外観・サイズ（.pill-group / .pill-group-bottom / .pill-chip /
   .pill-devserver-btn / .pill-close-btn）はTerminalPaneのInfo Pillsと完全に
   共通化するため、ui/styles/info-pills.css のグローバル定義をそのまま使う
   （独自の上書きを持たない）。 */

.browser-pane-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.browser-pane-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

</style>
