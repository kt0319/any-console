<template>
  <LoginScreen ref="loginScreen" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import LoginScreen from "./LoginScreen.vue";
import { on } from "../app-bridge.js";

const loginScreen = ref(null);

onMounted(() => {
  on("app:showLogin", () => loginScreen.value?.show());
  on("app:hideLogin", () => loginScreen.value?.hide());
});
</script>
