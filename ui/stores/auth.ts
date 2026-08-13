import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_PREFIX_API_CACHE, LS_PREFIX_WS_META } from "../utils/constants.ts";
import { EP_AUTH_CHECK, EP_AUTH_LOGOUT, EP_DEVICES_REGISTER, pairingClaimPath } from "../utils/endpoints.ts";

export const useAuthStore = defineStore("auth", () => {
  // 実トークンは cookie で管理されるため保持しない。認証済みかどうかのフラグのみ持つ。
  const authed = ref(false);
  const serverHostname = ref("");
  const isHandlingUnauthorized = ref(false);

  async function apiFetch(endpoint: string, { method = "GET", body = null }: { method?: string, body?: any } = {}): Promise<Response | null> {
    const headers: Record<string, string> = {};
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

  async function registerDevice(rawToken: string, name = "") {
    const res = await fetch(EP_DEVICES_REGISTER, {
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

  /**
   * QRペアリングのclaim。registerDevice と同様、cookie発行前なので生fetchを使う
   * （apiFetch は既認証セッション向けの401ハンドリングを持つため不適）。
   */
  async function claimPairing(pairingId: string, pairingToken: string) {
    let res;
    try {
      res = await fetch(pairingClaimPath(pairingId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pairingToken }),
        credentials: "same-origin",
      });
    } catch (e) {
      return { ok: false, error: `Cannot connect to server: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status === 401) return { ok: false, error: "Invalid pairing link" };
    if (res.status === 410) return { ok: false, error: "This pairing link has expired or was already used" };
    if (res.status === 429) return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
    if (!res.ok) return { ok: false, error: `Pairing failed: ${res.status}` };
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
      return { ok: true, hostname: data.hostname };
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

  function setServerInfo(hostname: string) {
    if (hostname) serverHostname.value = hostname;
  }

  function markAuthenticated() {
    authed.value = true;
  }

  function clearPersistedApiCaches() {
    const keysToDelete: string[] = [];
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
    apiFetch,
    registerDevice,
    claimPairing,
    logout,
    checkToken,
    setServerInfo,
    markAuthenticated,
  };
});
