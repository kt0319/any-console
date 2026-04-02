<template>
  <div class="modal-scroll-body">
    <div
      v-for="(row, i) in rows"
      :key="i"
      class="server-info-row"
    >
      <span class="server-info-label">{{ row.label }}</span>
      <span class="server-info-values">
        <span class="server-info-value">{{ row.value }}</span>
      </span>
    </div>
  </div>
</template>

<script setup>
import { inject, computed } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useLayoutStore } from "../stores/layout.js";
import { LS_KEY_DEVICE_NAME } from "../utils/constants.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Client Info";

const authStore = useAuthStore();
const layoutStore = useLayoutStore();

function parseBrowser(ua) {
  const tests = [
    [/Edg(?:e|A|iOS)?\/(\S+)/, "Edge"],
    [/OPR\/(\S+)|Opera\/(\S+)/, "Opera"],
    [/Chrome\/(\S+)/, "Chrome"],
    [/Version\/(\S+).*Safari/, "Safari"],
    [/Firefox\/(\S+)/, "Firefox"],
  ];
  for (const [re, name] of tests) {
    const m = ua.match(re);
    if (m) {
      const ver = (m[1] || m[2] || "").split(".").slice(0, 2).join(".");
      return `${name} ${ver}`;
    }
  }
  return ua.slice(0, 50);
}

const rows = computed(() => {
  const deviceName = localStorage.getItem(LS_KEY_DEVICE_NAME);
  const items = [];
  if (deviceName) items.push({ label: "Device Name", value: deviceName });
  if (authStore.clientName) items.push({ label: "Client Name", value: authStore.clientName });
  items.push(
    { label: "VPN (Tailscale)", value: authStore.vpn ? "Yes" : "No" },
    { label: "Browser", value: parseBrowser(navigator.userAgent) },
    { label: "Platform", value: navigator.userAgentData?.platform || navigator.platform || "-" },
    { label: "Screen", value: `${screen.width} x ${screen.height}` },
    { label: "Viewport", value: `${window.innerWidth} x ${window.innerHeight}` },
    { label: "Touch", value: layoutStore.isTouchDevice ? "Yes" : "No" },
    { label: "PWA", value: layoutStore.isPwa ? "Yes" : "No" },
    { label: "Online", value: navigator.onLine ? "Yes" : "No" },
    { label: "Language", value: navigator.language },
  );
  return items;
});
</script>

<style scoped>
.server-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  min-height: 32px;
}

.server-info-row:last-child {
  border-bottom: none;
}

.server-info-label {
  color: var(--text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-info-values {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.server-info-value {
  color: var(--text-primary);
  text-align: right;
  min-width: 44px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
