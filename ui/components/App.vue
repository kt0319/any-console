<template>
  <div v-if="fatalError" class="fatal-error-overlay">
    <span class="mdi mdi-alert-circle-outline fatal-error-icon"></span>
    <span class="fatal-error-msg">{{ fatalError }}</span>
    <button class="fatal-error-reload" @click="location.reload()">Reload</button>
  </div>
  <ScreenPair v-if="pairInfo" :pairing-id="pairInfo.id" :pairing-token="pairInfo.token" />
  <template v-else>
    <ScreenLogin v-if="showLogin" @authenticated="onAuthenticated" />
    <template v-if="authenticated">
      <ScreenMain />
    </template>
  </template>
  <AppToast ref="appToast" />
  <ConfirmDialog />
  <PromptDialog />
  <UrlActionDialog />
</template>

<script setup lang="ts">
import { ref, onMounted, onErrorCaptured } from "vue";
import ScreenLogin from "./ScreenLogin.vue";
import ScreenMain from "./ScreenMain.vue";
import ScreenPair from "./ScreenPair.vue";
import AppToast from "./AppToast.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import PromptDialog from "./PromptDialog.vue";
import UrlActionDialog from "./UrlActionDialog.vue";
import { on } from "../app-bridge.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useAppConnectivity } from "../composables/useAppConnectivity.ts";
import { useAppDocumentTitle } from "../composables/useAppDocumentTitle.ts";
import { useAppAuthGate } from "../composables/useAppAuthGate.ts";
import { parsePairUrl } from "../utils/pairing.ts";

const layoutStore = useLayoutStore();

// テンプレート（Reloadボタン）から参照するためのグローバル location。
const location = window.location;

const fatalError = ref<string | null>(null);

onErrorCaptured((err) => {
  fatalError.value = err?.message || String(err);
  return false;
});

// "/pair/{id}?t=..." はQRペアリングのclaim画面。vue-router非導入のため、起動時の
// URLをパースするだけの単純なルーティングで済ませる(ui/utils/pairing.js参照)。
const pairInfo = parsePairUrl(location.pathname, location.search);

useAppDocumentTitle();
useAppConnectivity();
const { showLogin, authenticated, onAuthenticated, checkAuthOnBoot } = useAppAuthGate();
const appToast = ref<InstanceType<typeof AppToast> | null>(null);

onMounted(async () => {
  if (layoutStore.isPwa) document.documentElement.classList.add("pwa");

  on("toast:show", ({ message, type, duration, action }) => appToast.value?.show(message, type, duration, action));

  // ペアリング画面は未認証で開くページなので、通常の認証チェック(未認証トースト等)
  // は不要かつログイン画面のちらつきの原因になるためスキップする。
  if (!pairInfo) await checkAuthOnBoot();
});

</script>

<style scoped>
.fatal-error-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
}

.fatal-error-icon {
  font-size: 40px;
  color: var(--error);
}

.fatal-error-msg {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  max-width: 360px;
  word-break: break-word;
  font-family: ui-monospace, monospace;
}

.fatal-error-reload {
  font-size: 13px;
  padding: 7px 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
}
</style>
