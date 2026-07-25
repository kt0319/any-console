<template>
  <div class="pair-screen">
    <div class="pair-box">
      <h2>any-console</h2>
      <div class="pair-claim-status" v-if="claiming">
        <span class="mdi mdi-loading pair-claim-spin"></span>
        Signing in...
      </div>
      <template v-else-if="errorMessage">
        <div class="pair-claim-status pair-claim-error">
          <span class="mdi mdi-alert-circle-outline"></span>
          {{ errorMessage }}
        </div>
        <button type="button" class="primary" @click="goToTokenLogin">Enter token instead</button>
      </template>
      <div class="pair-claim-status pair-claim-success" v-else>
        <span class="mdi mdi-check-circle"></span>
        Signed in. Redirecting...
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth.js";

const props = defineProps({
  pairingId: { type: String, required: true },
  pairingToken: { type: String, required: true },
});

const auth = useAuthStore();
const claiming = ref(true);
const errorMessage = ref("");

function goToTokenLogin() {
  // クエリ・/pair パスを消して通常のトークン入力ログインへフォールバックする。
  window.location.href = "/";
}

onMounted(async () => {
  if (!props.pairingToken) {
    claiming.value = false;
    errorMessage.value = "This link is missing its pairing code.";
    return;
  }
  const result = await auth.claimPairing(props.pairingId, props.pairingToken);
  claiming.value = false;
  if (!result.ok) {
    errorMessage.value = result.error || "Pairing failed.";
    return;
  }
  // cookie発行済み。pairingToken が残った URL を履歴・共有スクショに残さないよう、
  // クリーンな "/" へ遷移して通常の起動フロー(認証チェック→メイン画面)に合流する。
  window.location.href = "/";
});
</script>

<style scoped>
.pair-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--app-dvh);
  padding: 20px;
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--bg-primary);
}
.pair-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  width: 100%;
  max-width: 360px;
  text-align: center;
}
.pair-box h2 {
  font-size: 18px;
  margin-bottom: 20px;
  color: var(--accent);
}
.pair-claim-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 16px;
}
.pair-claim-status .mdi {
  font-size: 20px;
}
.pair-claim-error {
  color: var(--error);
}
.pair-claim-success {
  color: var(--success);
}
.pair-claim-spin {
  animation: pair-claim-spin 0.6s linear infinite;
}
@keyframes pair-claim-spin {
  to { transform: rotate(360deg); }
}
</style>
