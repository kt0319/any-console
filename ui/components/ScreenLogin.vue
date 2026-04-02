<template>
  <div v-if="visible" class="login-screen">
    <form class="login-box" @submit.prevent="handleLogin">
      <h2>any-console</h2>
      <input
        ref="tokenInput"
        v-model="tokenValue"
        type="password"
        placeholder="Token"
        autocomplete="current-password"
        name="token"
      />
      <div v-if="errorMessage" class="login-error">{{ errorMessage }}</div>
      <button class="primary" type="submit" :disabled="submitting">Login</button>
    </form>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const emits = defineEmits(["authenticated"]);

const visible = ref(true);
const tokenValue = ref("");
const errorMessage = ref("");
const submitting = ref(false);
const tokenInput = ref(null);

async function handleLogin() {
  const val = tokenValue.value.trim();
  if (!val || submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";

  auth.token = val;
  const result = await auth.checkToken();

  if (result.ok) {
    auth.setServerInfo(result.hostname, result.version, result.clientName, result.vpn);
    auth.saveToken(auth.token);
    visible.value = false;
    emits("authenticated");
  } else {
    errorMessage.value = result.error;
    auth.token = "";
  }
  submitting.value = false;
}

function show() {
  visible.value = true;
  tokenValue.value = "";
  errorMessage.value = "";
  nextTick(() => tokenInput.value?.focus());
}

function hide() {
  visible.value = false;
}

defineExpose({ show, hide, visible });
</script>

<style scoped>
.login-screen {
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
.login-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  width: 100%;
  max-width: 360px;
}
.login-box h2 {
  font-size: 18px;
  margin-bottom: 20px;
  color: var(--accent);
  text-align: center;
}
.login-box input {
  width: 100%;
  padding: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 16px;
}
.login-box input:focus {
  outline: none;
  border-color: var(--accent);
}
.login-error {
  color: var(--error);
  font-size: 13px;
  margin-bottom: 12px;
}
</style>
