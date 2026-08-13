import { useAuthStore } from "../stores/auth.ts";
import { emit } from "../app-bridge.js";
import { extractApiError } from "../utils/constants.ts";
import { debugLog } from "./useClientLogs.js";

export function useApi() {
  const auth = useAuthStore();

  function showErrorToast(data, errorMessage) {
    if (errorMessage) {
      emit("toast:show", { message: extractApiError(data, errorMessage), type: "error" });
    }
  }

  /**
   * @param {string} endpoint
   * @param {{ method?: string, body?: any, checkStatus?: boolean, errorMessage?: string }} [opts]
   */
  async function apiRequest(endpoint, opts = {}) {
    const { method = "GET", body = null, checkStatus = false, errorMessage } = opts;
    const fetchOpts = method === "GET" ? undefined : { method, ...(body != null && { body }) };
    const t0 = performance.now();
    let res;
    try {
      res = await auth.apiFetch(endpoint, fetchOpts);
    } catch {
      debugLog("[API]", method, endpoint, "network error");
      showErrorToast(null, errorMessage);
      return { ok: false, data: null };
    }
    const ms = Math.round(performance.now() - t0);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      debugLog("[API]", method, endpoint, `failed status=${res?.status ?? "n/a"}`, `${ms}ms`);
      showErrorToast(data, errorMessage);
      return { ok: false, data };
    }
    const data = await res.json().catch(() => null);
    const ok = checkStatus ? data?.status === "ok" : data != null;
    debugLog("[API]", method, endpoint, ok ? `ok ${ms}ms` : `bad-status ${ms}ms`);
    if (!ok) showErrorToast(data, errorMessage);
    return { ok, data };
  }

  const apiGet = (endpoint, opts) => apiRequest(endpoint, opts);
  const apiPost = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "POST", body, ...opts });
  const apiPut = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "PUT", body, ...opts });
  const apiPatch = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "PATCH", body, ...opts });
  const apiDelete = (endpoint, opts) => apiRequest(endpoint, { method: "DELETE", ...opts });
  const apiCommand = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "POST", body, checkStatus: true, ...opts });

  /**
   * @param {string} endpoint
   * @param {Record<string, any>} body
   * @param {{ successMessage: string, errorMessage: string, onSuccess?: () => void }} opts
   */
  async function apiWithToast(endpoint, body, { successMessage, errorMessage, onSuccess }) {
    try {
      const { ok, data } = await apiCommand(endpoint, body, { errorMessage });
      if (!ok) return false;
      emit("toast:show", { message: successMessage, type: "success" });
      onSuccess?.();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit("toast:show", { message, type: "error" });
      return false;
    }
  }

  function wsEndpoint(workspace, path) {
    return `/workspaces/${encodeURIComponent(workspace)}/${path}`;
  }

  return { apiCommand, apiWithToast, apiGet, apiPost, apiPut, apiPatch, apiDelete, wsEndpoint };
}
