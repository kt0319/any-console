<template>
  <div class="modal-scroll-body">
    <label class="settings-item settings-toggle" :class="{ 'preview-disabled': !loaded }">
      <input
        type="checkbox"
        :checked="httpsEnabled"
        :disabled="!loaded"
        @change="onToggle"
      />
      <div class="settings-toggle-copy">
        <span class="settings-item-label">HTTPS</span>
        <span class="settings-note">
          Serve the preview proxy over HTTPS when a certificate is available.
          Applies to previews started after the change.
        </span>
        <span v-if="loaded && httpsEnabled && !hasCertificate" class="settings-note">
          No certificate found. Run "./any-console https-setup" on the server.
        </span>
      </div>
    </label>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useModalView } from "../composables/useModalView.ts";
import { EP_SETTINGS_PREVIEW, EP_SYSTEM_INFO } from "../utils/endpoints.ts";

const { modalTitle } = useModalView();
modalTitle!.value = "Preview Server";

const { apiGet, apiPut } = useApi();

const httpsEnabled = ref(true);
const hasCertificate = ref(false);
const loaded = ref(false);

onMounted(async () => {
  const [settings, info] = await Promise.all([apiGet(EP_SETTINGS_PREVIEW), apiGet(EP_SYSTEM_INFO)]);
  if (settings.ok && typeof settings.data?.https === "boolean") httpsEnabled.value = settings.data.https;
  if (info.ok) hasCertificate.value = info.data?.preview_https === true;
  loaded.value = true;
});

async function onToggle(event: Event) {
  const next = (event.target as HTMLInputElement).checked;
  const { ok } = await apiPut(EP_SETTINGS_PREVIEW, { https: next }, { errorMessage: "Failed to save preview settings" });
  if (ok) httpsEnabled.value = next;
  else (event.target as HTMLInputElement).checked = httpsEnabled.value;
}
</script>

<style scoped>
.preview-disabled {
  opacity: 0.5;
}
</style>
