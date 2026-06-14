import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_TOKEN, LS_PREFIX_API_CACHE, LS_PREFIX_WS_META, COOKIE_NAME_TOKEN } from "../utils/constants.js";
import { EP_AUTH_CHECK, EP_AUTH_LOGIN, EP_AUTH_LOGOUT } from "../utils/endpoints.js";

const AUTHED_SENTINEL = "1";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const serverHostname = ref("");
  const serverVersion = ref("");
  const isHandlingUnauthorized = ref(false);

  /**
   * @param {string} endpoint
   * @param {{ method?: string, body?: any }} [options]
   */
  async function apiFetch(endpoint, { method = "GET", body = null } = {}) {
    /** @type {Record<string, string>} */
    const headers = {};
    if (body !== null && typeof body === "object" && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(endpoint, { method, headers, body, credentials: "same-origin" });
    if (res.status === 401) {
      await handleUnauthorized();
      return null;
    }
    return res;
  }

  async function login(rawToken) {
    const res = await fetch(EP_AUTH_LOGIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
      credentials: "same-origin",
    });
    if (res.status === 401) return { ok: false, error: "Invalid token" };
    if (!res.ok) return { ok: false, error: `Login failed: ${res.status}` };
    token.value = AUTHED_SENTINEL;
    return { ok: true };
  }

  async function registerDevice(rawToken, name = "") {
    const res = await fetch("/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, name }),
      credentials: "same-origin",
    });
    if (res.status === 401) return { ok: false, error: "Invalid token" };
    if (!res.ok) return { ok: false, error: `Registration failed: ${res.status}` };
    const data = await res.json().catch(() => ({}));
    token.value = AUTHED_SENTINEL;
    return { ok: true, deviceId: data.device_id, name: data.name };
  }

  async function logout() {
    try {
      await fetch(EP_AUTH_LOGOUT, { method: "POST", credentials: "same-origin" });
    } catch {
      /* ignore */
    }
    clearLocalState();
  }

  function clearLocalState() {
    clearPersistedApiCaches();
    token.value = "";
  }

  async function migrateLegacyToken() {
    const legacy = localStorage.getItem(LS_KEY_TOKEN);
    const legacyCookie = readLegacyCookie();
    const candidate = legacy || legacyCookie;
    if (legacy) localStorage.removeItem(LS_KEY_TOKEN);
    if (legacyCookie) deleteLegacyCookie();
    if (!candidate) return false;
    const result = await login(candidate);
    return result.ok;
  }

  function readLegacyCookie() {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME_TOKEN}=([^;]*)`));
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }

  function deleteLegacyCookie() {
    document.cookie = `${COOKIE_NAME_TOKEN}=;path=/;max-age=0;SameSite=Strict`;
  }

  async function checkToken() {
    try {
      const res = await fetch(EP_AUTH_CHECK, { credentials: "same-origin" });
      if (res.status === 401) return { ok: false, auth: false, error: "Authentication failed" };
      const data = await res.json();
      return { ok: true, hostname: data.hostname, version: data.version };
    } catch (e) {
      return { ok: false, auth: true, error: `Cannot connect to server: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async function handleUnauthorized() {
    if (isHandlingUnauthorized.value || !token.value) return false;
    isHandlingUnauthorized.value = true;
    try {
      const res = await fetch(EP_AUTH_CHECK, { credentials: "same-origin" });
      if (res.status === 401) {
        clearLocalState();
        return true;
      }
    } catch {
    } finally {
      isHandlingUnauthorized.value = false;
    }
    return false;
  }

  function setServerInfo(hostname, version) {
    if (hostname) serverHostname.value = hostname;
    if (version) serverVersion.value = version;
  }

  function markAuthenticated() {
    token.value = AUTHED_SENTINEL;
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
    isHandlingUnauthorized,
    apiFetch,
    login,
    registerDevice,
    logout,
    migrateLegacyToken,
    checkToken,
    handleUnauthorized,
    setServerInfo,
    markAuthenticated,
  };
});
