import { useAuthStore } from "../stores/auth.js";

export function useApi() {
  const auth = useAuthStore();

  async function apiPost(endpoint, body = {}) {
    const res = await auth.apiFetch(endpoint, { method: "POST", body });
    if (!res || !res.ok) return { ok: false, data: null };
    const data = await res.json();
    return { ok: data.status === "ok", data };
  }

  async function apiGet(endpoint) {
    const res = await auth.apiFetch(endpoint);
    if (!res || !res.ok) return { ok: false, data: null };
    const data = await res.json();
    return { ok: true, data };
  }

  function wsEndpoint(workspace, path) {
    return `/workspaces/${encodeURIComponent(workspace)}/${path}`;
  }

  return { apiPost, apiGet, wsEndpoint };
}
