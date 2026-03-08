import { defineStore } from "pinia";
import { ref } from "vue";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const serverHostname = ref("");
  const serverVersion = ref("");
  const clientName = ref("");
  const isHandlingUnauthorized = ref(false);

  async function apiFetch(endpoint, { method = "GET", body = null } = {}) {
    const headers = { Authorization: `Bearer ${token.value}` };
    const deviceName = localStorage.getItem("deviceName");
    if (deviceName) headers["X-Device-Name"] = deviceName;
    if (body !== null && typeof body === "object") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(endpoint, { method, headers, body });
    if (res.status === 401) {
      await handleUnauthorized();
      return null;
    }
    return res;
  }

  function saveToken(val) {
    const prev = localStorage.getItem("pi_console_token") || "";
    if (prev && prev !== val) clearPersistedApiCaches();
    localStorage.setItem("pi_console_token", val);
    document.cookie = `pi_console_token=${encodeURIComponent(val)};path=/;max-age=31536000;SameSite=Strict`;
  }

  function clearToken() {
    clearPersistedApiCaches();
    localStorage.removeItem("pi_console_token");
    document.cookie = "pi_console_token=;path=/;max-age=0;SameSite=Strict";
  }

  function loadToken() {
    const ls = localStorage.getItem("pi_console_token");
    if (ls) return ls;
    const match = document.cookie.match(/(?:^|;\s*)pi_console_token=([^;]*)/);
    if (match) {
      try {
        const val = decodeURIComponent(match[1]);
        if (val) {
          localStorage.setItem("pi_console_token", val);
          return val;
        }
      } catch {}
    }
    return "";
  }

  async function checkToken() {
    try {
      const res = await fetch("/auth/check", {
        headers: { Authorization: `Bearer ${token.value}` },
      });
      if (res.status === 401) return { ok: false, auth: false, error: "認証に失敗しました" };
      const data = await res.json();
      return { ok: true, hostname: data.hostname, version: data.version, clientName: data.client_name };
    } catch (e) {
      return { ok: false, auth: true, error: `サーバーに接続できません: ${e.message}` };
    }
  }

  async function handleUnauthorized(caller) {
    if (isHandlingUnauthorized.value || !token.value) return false;
    isHandlingUnauthorized.value = true;
    try {
      const res = await fetch("/auth/check", {
        headers: { Authorization: `Bearer ${token.value}` },
      });
      if (res.status === 401) {
        clearToken();
        token.value = "";
        return true;
      }
    } catch {
    } finally {
      isHandlingUnauthorized.value = false;
    }
    return false;
  }

  function setServerInfo(hostname, version, client) {
    if (hostname) serverHostname.value = hostname;
    if (version) serverVersion.value = version;
    if (client) clientName.value = client;
  }

  function clearPersistedApiCaches() {
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("api_cache_") || key.startsWith("ws_meta_"))) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => localStorage.removeItem(k));
  }

  return {
    token,
    serverHostname,
    serverVersion,
    clientName,
    isHandlingUnauthorized,
    apiFetch,
    saveToken,
    clearToken,
    loadToken,
    checkToken,
    handleUnauthorized,
    setServerInfo,
  };
});
