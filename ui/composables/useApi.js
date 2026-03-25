import { useAuthStore } from "../stores/auth.js";

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

  function wsEndpoint(workspace, path) {
    return `/workspaces/${encodeURIComponent(workspace)}/${path}`;
  }

  return { apiCommand, apiGet, apiPost, apiPut, apiDelete, wsEndpoint };
}
