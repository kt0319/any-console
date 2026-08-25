<template>
  <div>
    <div class="settings-category-head">
      <span class="settings-category-title">Trusted Devices</span>
      <button
        v-if="tokenConfigured"
        type="button"
        class="auth-card-action"
        @click="$emit('addDevice')"
      >
        <span class="mdi mdi-qrcode-scan"></span> Add new device
      </button>
    </div>
    <div class="settings-note" style="margin-bottom: 8px;">
      Registered devices can sign in without entering a token. Revoke any device that should no longer have access.
    </div>
    <div v-if="devicesLoading" class="text-muted-center">Loading...</div>
    <template v-else>
      <div v-if="!devices.length" class="settings-note">No devices registered yet.</div>
      <SettingsEntryRow
        v-for="d in devices"
        :key="d.id"
        :sub="`Last seen: ${formatRelativeTime(d.last_seen_at)}`"
      >
        <template #name>
          {{ d.name }}
          <span v-if="d.current" class="device-tag">This device</span>
          <span v-if="d.source && d.source !== 'token'" class="device-tag source">{{ d.source }}</span>
        </template>
        <template #action>
          <button
            type="button"
            class="icon-btn-square danger"
            :aria-label="d.current ? 'Logout' : 'Revoke device'"
            :data-tooltip="d.current ? 'Logout' : 'Revoke'"
            @click="revoke(d)"
          >
            <span class="mdi" :class="d.current ? 'mdi-logout' : 'mdi-trash-can-outline'"></span>
          </button>
        </template>
      </SettingsEntryRow>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import SettingsEntryRow from "./SettingsEntryRow.vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { EP_DEVICES, devicePath } from "../utils/endpoints.ts";
import { formatRelativeTime } from "../utils/format.ts";

// Trusted Devices セクション（一覧・Revoke / Logout）。AuthConfig から分離。
defineProps({
  tokenConfigured: { type: Boolean, default: false },
});
defineEmits(["addDevice"]);

const { apiGet, apiDelete } = useApi();
const { confirm } = useConfirm();

// /devices の1件分（テンプレートで参照するフィールドのみ）。
type Device = { id: string, name: string, current?: boolean, source?: string, last_seen_at?: number };

const devices = ref<Device[]>([]);
const devicesLoading = ref(true);

async function loadDevices() {
  devicesLoading.value = true;
  const res = await getWithRetry(apiGet, EP_DEVICES);
  devices.value = res.ok && Array.isArray(res.data) ? res.data : [];
  devicesLoading.value = false;
}

async function revoke(d: Device) {
  const isSelf = !!d.current;
  const msg = isSelf
    ? `Logout this device "${d.name}"? You will need to sign in again.`
    : `Revoke device "${d.name}"? It will need to register again with a token.`;
  if (!await confirm(msg)) return;
  const { ok } = await apiDelete(devicePath(d.id), { errorMessage: "Failed to revoke" });
  if (!ok) return;
  if (isSelf) {
    location.reload();
    return;
  }
  await loadDevices();
}

onMounted(loadDevices);
</script>

<style scoped>
.settings-category-head {
  margin: 24px 0 10px;
}

.auth-card-action {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 44px;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.auth-card-action .mdi {
  font-size: 16px;
}

.device-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary);
}

.device-tag.source {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
</style>
