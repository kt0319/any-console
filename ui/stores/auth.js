import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_TOKEN, LS_KEY_DEVICE_NAME, LS_PREFIX_API_CACHE, LS_PREFIX_WS_META, COOKIE_NAME_TOKEN } from "../utils/constants.js";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const serverHostname = ref("");
  const serverVersion = ref("");
  const clientName = ref("");
  const isHandlingUnauthorized = ref(false);

  async function apiFetch(endpoint, { method = "GET", body = null } = {}) {
    const headers = { Authorization: `Bearer ${token.value}` };
    const deviceName = localStorage.getItem(LS_KEY_DEVICE_NAME);
    if (deviceName) headers["X-Device-Name"] = deviceName;
    if (body !== null && typeof body === "object" && !(body instanceof FormData)) {
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
    const prev = localStorage.getItem(LS_KEY_TOKEN) || "";
    if (prev && prev !== val) clearPersistedApiCaches();
    localStorage.setItem(LS_KEY_TOKEN, val);
    document.cookie = `${COOKIE_NAME_TOKEN}=${encodeURIComponent(val)};path=/;max-age=31536000;SameSite=Strict`;
  }

  function clearToken() {
    clearPersistedApiCaches();
    localStorage.removeItem(LS_KEY_TOKEN);
    document.cookie = `${COOKIE_NAME_TOKEN}=;path=/;max-age=0;SameSite=Strict`;
  }

  function loadToken() {
    const ls = localStorage.getItem(LS_KEY_TOKEN);
    if (ls) return ls;
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME_TOKEN}=([^;]*)`));
    if (match) {
      try {
        const val = decodeURIComponent(match[1]);
        if (val) {
          localStorage.setItem(LS_KEY_TOKEN, val);
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
      if (key && (key.startsWith(LS_PREFIX_API_CACHE) || key.startsWith(LS_PREFIX_WS_META))) {
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
