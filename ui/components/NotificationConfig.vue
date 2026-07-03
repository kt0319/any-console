<template>
  <div class="modal-scroll-body">
    <label class="settings-item settings-toggle" :class="{ 'notif-disabled': !isSupported || permission === 'denied' || loading }">
      <input
        type="checkbox"
        :checked="isSubscribed"
        :disabled="!isSupported || permission === 'denied' || loading"
        @change="onToggle"
      />
      <div class="settings-toggle-copy">
        <span class="settings-item-label">Push notifications</span>
        <span class="settings-note">
          <template v-if="!isSupported">Not supported in this browser (requires HTTPS).</template>
          <template v-else-if="permission === 'denied'">Blocked in browser settings. Allow and reload to enable.</template>
          <template v-else>Notify when a dispatch is accepted, even when the tab is in the background.</template>
        </span>
      </div>
    </label>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { usePushNotification } from "../composables/usePushNotification.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Notifications";

const { isSupported, isSubscribed, permission, subscribe, unsubscribe, init } = usePushNotification();
const loading = ref(false);

async function onToggle() {
  loading.value = true;
  if (isSubscribed.value) {
    await unsubscribe();
  } else {
    await subscribe();
  }
  loading.value = false;
}

onMounted(init);
</script>

<style scoped>
.notif-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
