<template>
  <LoginScreen ref="loginScreen" />
  <AppToast ref="appToast" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import LoginScreen from "./LoginScreen.vue";
import AppToast from "./AppToast.vue";
import { on } from "../app-bridge.js";

const loginScreen = ref(null);
const appToast = ref(null);

onMounted(() => {
  on("app:showLogin", () => loginScreen.value?.show());
  on("app:hideLogin", () => loginScreen.value?.hide());
  on("toast:show", ({ message, type }) => appToast.value?.show(message, type));
});
</script>
