import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";
import { extractApiError } from "../utils/constants.js";

export function useApi() {
  const auth = useAuthStore();

  async function apiRequest(endpoint, { method = "GET", body = null, checkStatus = false } = {}) {
    const opts = method === "GET" ? undefined : { method, ...(body != null && { body }) };
    const res = await auth.apiFetch(endpoint, opts);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      return { ok: false, data };
    }
    const data = await res.json().catch(() => null);
    const ok = checkStatus ? data?.status === "ok" : data != null;
    return { ok, data };
  }

  const apiGet = (endpoint) => apiRequest(endpoint);
  const apiPost = (endpoint, body = {}) => apiRequest(endpoint, { method: "POST", body });
  const apiPut = (endpoint, body = {}) => apiRequest(endpoint, { method: "PUT", body });
  const apiDelete = (endpoint) => apiRequest(endpoint, { method: "DELETE" });
  const apiCommand = (endpoint, body = {}) => apiRequest(endpoint, { method: "POST", body, checkStatus: true });

  async function apiWithToast(endpoint, body, { successMessage, errorMessage, onSuccess }) {
    try {
      const { ok, data } = await apiCommand(endpoint, body);
      if (!ok) {
        emit("toast:show", { message: extractApiError(data, errorMessage), type: "error" });
        return false;
      }
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
