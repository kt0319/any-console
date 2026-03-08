<template>
  <LoginScreen ref="loginScreen" />
  <SettingsModal ref="settingsModal" />
  <JobConfirmModal ref="jobConfirmModal" />
  <IconPicker ref="iconPicker" />
  <FileModal ref="fileModal" />
  <AppToast ref="appToast" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import LoginScreen from "./LoginScreen.vue";
import SettingsModal from "./SettingsModal.vue";
import JobConfirmModal from "./JobConfirmModal.vue";
import IconPicker from "./IconPicker.vue";
import FileModal from "./FileModal.vue";
import AppToast from "./AppToast.vue";
import { on } from "../app-bridge.js";

const loginScreen = ref(null);
const settingsModal = ref(null);
const jobConfirmModal = ref(null);
const iconPicker = ref(null);
const fileModal = ref(null);
const appToast = ref(null);

onMounted(() => {
  on("app:showLogin", () => loginScreen.value?.show());
  on("app:hideLogin", () => loginScreen.value?.hide());
  on("toast:show", ({ message, type }) => appToast.value?.show(message, type));
  on("settings:open", (detail) => settingsModal.value?.open(detail?.view));
  on("settings:close", () => settingsModal.value?.close());
  on("job:openConfirm", ({ name, job, workspace }) => jobConfirmModal.value?.open(name, job, workspace));
  on("job:closeConfirm", () => jobConfirmModal.value?.close());
  on("iconPicker:open", ({ callback, currentIcon, currentColor }) => iconPicker.value?.open(callback, currentIcon, currentColor));
  on("iconPicker:close", () => iconPicker.value?.close());
  on("git:openFileModal", (detail) => fileModal.value?.open(detail));
  on("git:closeFileModal", () => fileModal.value?.close());
});
</script>
