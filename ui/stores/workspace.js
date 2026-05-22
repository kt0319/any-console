import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "../composables/useApi.js";
import { EP_WORKSPACES, EP_WORKSPACES_STATUSES } from "../utils/endpoints.js";
import { LS_PREFIX_WS_META } from "../utils/constants.js";

const STATUS_CACHE_KEY = LS_PREFIX_WS_META + "status_cache";
const STATUS_CACHE_FIELDS = ["last_commit_message", "branch"];

function loadStatusCache() {
  try {
    const raw = localStorage.getItem(STATUS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStatusCache(cache) {
  try {
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota or other — ignore */
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const { apiGet } = useApi();
  const allWorkspaces = ref([]);
  const selectedWorkspace = ref(null);
  const workspaceJobs = ref({});
  const pendingJob = ref(null);
  const visibleWorkspaces = computed(() =>
    allWorkspaces.value.filter((ws) => !ws.hidden),
  );

  const currentWorkspace = computed(() =>
    allWorkspaces.value.find((w) => w.name === selectedWorkspace.value),
  );

  async function _safeFetch(endpoint) {
    try {
      return await apiGet(endpoint);
    } catch {
      return { ok: false, data: null };
    }
  }

  async function fetchWorkspaces() {
    const { ok, data } = await _safeFetch(EP_WORKSPACES);
    if (!ok || !Array.isArray(data)) return;
    const existingByName = new Map(allWorkspaces.value.map((w) => [w.name, w]));
    const cache = loadStatusCache();
    allWorkspaces.value = data.map((newWs) => {
      const existing = existingByName.get(newWs.name);
      const cached = cache[newWs.name] || {};
      // キャッシュ値 → 既存値 → 新値の順で上書き（新値は nullish なら無視）。
      // これでリロード直後でも last_commit_message が即座に出る。
      const merged = { ...cached, ...(existing || {}) };
      for (const [k, v] of Object.entries(newWs)) {
        if (v != null) merged[k] = v;
      }
      return merged;
    });
  }

  async function fetchStatuses() {
    const { ok, data } = await _safeFetch(EP_WORKSPACES_STATUSES);
    if (!ok) return;
    if (!data?.statuses) return;
    const cache = loadStatusCache();
    for (const status of data.statuses) {
      const ws = allWorkspaces.value.find((w) => w.name === status.name);
      if (!ws) continue;
      for (const [k, v] of Object.entries(status)) {
        if (v != null) ws[k] = v;
      }
      const entry = {};
      for (const field of STATUS_CACHE_FIELDS) {
        if (ws[field] != null) entry[field] = ws[field];
      }
      cache[status.name] = entry;
    }
    saveStatusCache(cache);
  }

  return {
    allWorkspaces,
    selectedWorkspace,
    workspaceJobs,
    pendingJob,
    visibleWorkspaces,
    currentWorkspace,
    fetchWorkspaces,
    fetchStatuses,
  };
});
