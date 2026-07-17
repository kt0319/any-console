import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_PREFIX_API_CACHE, LS_PREFIX_WS_META } from "../utils/constants.js";
import { EP_AUTH_CHECK, EP_AUTH_LOGOUT } from "../utils/endpoints.js";

export const useAuthStore = defineStore("auth", () => {
  // 実トークンは cookie で管理されるため保持しない。認証済みかどうかのフラグのみ持つ。
  const authed = ref(false);
  const serverHostname = ref("");
  const serverCommitDate = ref("");
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
    authed.value = true;
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
    authed.value = false;
  }

  async function checkToken() {
    try {
      const res = await fetch(EP_AUTH_CHECK, { credentials: "same-origin" });
      if (res.status === 401) return { ok: false, auth: false, error: "Authentication failed" };
      const data = await res.json();
      return { ok: true, hostname: data.hostname, commitDate: data.commit_date };
    } catch (e) {
      return { ok: false, auth: true, error: `Cannot connect to server: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async function handleUnauthorized() {
    if (isHandlingUnauthorized.value || !authed.value) return false;
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

  function setServerInfo(hostname, commitDate) {
    if (hostname) serverHostname.value = hostname;
    if (commitDate) serverCommitDate.value = commitDate;
  }

  function markAuthenticated() {
    authed.value = true;
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
    authed,
    serverHostname,
    serverCommitDate,
    isHandlingUnauthorized,
    apiFetch,
    registerDevice,
    logout,
    checkToken,
    handleUnauthorized,
    setServerInfo,
    markAuthenticated,
  };
});
