import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";
import { extractApiError } from "../utils/constants.js";

export function useApi() {
  const auth = useAuthStore();

  function showErrorToast(data, errorMessage) {
    if (errorMessage) {
      emit("toast:show", { message: extractApiError(data, errorMessage), type: "error" });
    }
  }

  async function apiRequest(endpoint, { method = "GET", body = null, checkStatus = false, errorMessage } = {}) {
    const opts = method === "GET" ? undefined : { method, ...(body != null && { body }) };
    const res = await auth.apiFetch(endpoint, opts);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      showErrorToast(data, errorMessage);
      return { ok: false, data };
    }
    const data = await res.json().catch(() => null);
    const ok = checkStatus ? data?.status === "ok" : data != null;
    if (!ok) showErrorToast(data, errorMessage);
    return { ok, data };
  }

  const apiGet = (endpoint, opts) => apiRequest(endpoint, opts);
  const apiPost = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "POST", body, ...opts });
  const apiPut = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "PUT", body, ...opts });
  const apiDelete = (endpoint, opts) => apiRequest(endpoint, { method: "DELETE", ...opts });
  const apiCommand = (endpoint, body = {}, opts) => apiRequest(endpoint, { method: "POST", body, checkStatus: true, ...opts });

  async function apiWithToast(endpoint, body, { successMessage, errorMessage, onSuccess }) {
    try {
      const { ok, data } = await apiCommand(endpoint, body, { errorMessage });
      if (!ok) return false;
      emit("toast:show", { message: successMessage, type: "success" });
      onSuccess?.();
      return true;
    } catch (e) {
      emit("toast:show", { message: e.message, type: "error" });
      return false;
    }
  }

  function wsEndpoint(workspace, path) {
    return `/workspaces/${encodeURIComponent(workspace)}/${path}`;
  }

  return { apiCommand, apiWithToast, apiGet, apiPost, apiPut, apiDelete, wsEndpoint };
}
