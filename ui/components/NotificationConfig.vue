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
        <input type="checkbox" v-model="prefs.blocked" @change="savePrefs" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Agent blocked</span>
          <span class="settings-note">When an agent needs your input to continue.</span>
        </div>
      </label>
      <label v-if="prefs.phrase" class="settings-item">
        <span class="settings-item-label">Phrase notify delay</span>
        <input
          type="number"
          min="0"
          :max="PHRASE_NOTIFY_GRACE_SEC_MAX"
          class="form-input notif-grace-input"
          v-model.number="graceSec"
        />
        <span class="settings-note">
          Seconds to wait after the phrase appears before sending a push
          (avoids notifying while you're already watching).
        </span>
      </label>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
import { usePushNotification } from "../composables/usePushNotification.ts";
import { useApi } from "../composables/useApi.ts";
import { EP_SETTINGS_NOTIFICATIONS } from "../utils/endpoints.ts";
import {
  LS_KEY_NOTIF_PREFS,
  NOTIFY_GRACE_DEBOUNCE_MS,
  PHRASE_NOTIFY_GRACE_SEC_DEFAULT,
  PHRASE_NOTIFY_GRACE_SEC_MAX,
} from "../utils/constants.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";
import { useModalView } from "../composables/useModalView.ts";

const { modalTitle } = useModalView();
modalTitle.value = "Notifications";

const { isSupported, isSubscribed, permission, subscribe, unsubscribe, init } = usePushNotification();
const { apiGet, apiPut } = useApi();
const loading = ref(false);
const graceSec = ref(PHRASE_NOTIFY_GRACE_SEC_DEFAULT);
let graceSecLoaded = false;

async function loadGraceSec() {
  const { ok, data } = await apiGet(EP_SETTINGS_NOTIFICATIONS);
  if (ok && Number.isInteger(data?.phrase_notify_grace_sec)) {
    graceSec.value = data.phrase_notify_grace_sec;
  }
  graceSecLoaded = true;
}

let graceSaveTimer = null;
watch(graceSec, (val) => {
  if (!graceSecLoaded) return;
  clearTimeout(graceSaveTimer);
  graceSaveTimer = setTimeout(async () => {
    const clamped = Math.min(PHRASE_NOTIFY_GRACE_SEC_MAX, Math.max(0, Number.isFinite(val) ? Math.trunc(val) : PHRASE_NOTIFY_GRACE_SEC_DEFAULT));
    graceSec.value = clamped;
    await apiPut(EP_SETTINGS_NOTIFICATIONS, { phrase_notify_grace_sec: clamped });
  }, NOTIFY_GRACE_DEBOUNCE_MS);
});

const DEFAULT_PREFS = { dispatch: true, phrase: true, blocked: true };

const prefs = ref({ ...DEFAULT_PREFS });

function loadPrefs() {
  const saved = safeJsonLoad(LS_KEY_NOTIF_PREFS, null);
  if (saved) prefs.value = { ...DEFAULT_PREFS, ...saved };
}

async function savePrefs() {
  safeJsonSave(LS_KEY_NOTIF_PREFS, prefs.value);
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
  await loadGraceSec();
});
</script>

<style scoped>
.notif-grace-input {
  max-width: 100px;
}

.notif-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.notif-section-title {
  padding: 12px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.06em;
}
</style>
