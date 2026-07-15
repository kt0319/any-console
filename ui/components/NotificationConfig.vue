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
          <template v-else>Notify in the background. Requires PWA install.</template>
        </span>
      </div>
    </label>

    <template v-if="isSubscribed">
      <div class="notif-section-title">Notify on</div>
      <label class="settings-item settings-toggle">
        <input type="checkbox" v-model="prefs.dispatch" @change="savePrefs" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Dispatch requested</span>
          <span class="settings-note">When a dispatch request needs your approval.</span>
        </div>
      </label>
      <label class="settings-item settings-toggle">
        <input type="checkbox" v-model="prefs.phrase" @change="savePrefs" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Phrase detected</span>
          <span class="settings-note">When a "Notify phrase" appears in job output.</span>
        </div>
      </label>
      <label class="settings-item settings-toggle">
        <input type="checkbox" v-model="prefs.job_done" @change="savePrefs" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Job finished</span>
          <span class="settings-note">When a job (non-terminal) exits.</span>
        </div>
      </label>
    </template>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { usePushNotification } from "../composables/usePushNotification.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Notifications";

const { isSupported, isSubscribed, permission, subscribe, unsubscribe, init } = usePushNotification();
const loading = ref(false);

const PREFS_KEY = "notifPrefs";
const DEFAULT_PREFS = { dispatch: true, phrase: true, job_done: true };

const prefs = ref({ ...DEFAULT_PREFS });

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) prefs.value = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch (_e) {}
}

async function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value));
  } catch (_e) {}
  await syncPrefsToSW();
}

async function syncPrefsToSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "sync-notif-prefs", prefs: prefs.value });
  } catch (_e) {}
}

async function onToggle() {
  loading.value = true;
  if (isSubscribed.value) {
    await unsubscribe();
  } else {
    await subscribe();
  }
  loading.value = false;
}

onMounted(async () => {
  loadPrefs();
  await init();
  await syncPrefsToSW();
});
</script>

<style scoped>
.notif-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.notif-section-title {
  padding: 12px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
</style>
