<template>
  <div class="modal-scroll-body">
    <label class="notif-item notif-toggle" :class="{ 'notif-disabled': !isSupported || permission === 'denied' || loading }">
      <input
        type="checkbox"
        :checked="isSubscribed"
        :disabled="!isSupported || permission === 'denied' || loading"
        @change="onToggle"
      />
      <div class="notif-toggle-copy">
        <span class="notif-label">Push notifications</span>
        <span class="notif-note">
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
.notif-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border);
}

.notif-item:last-of-type {
  border-bottom: none;
}

.notif-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.notif-toggle {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  cursor: pointer;
}

.notif-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.notif-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.notif-toggle input[type="checkbox"] {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}

.notif-note {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
