import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "../composables/useApi.js";
import { EP_WORKSPACES, EP_WORKSPACES_STATUSES } from "../utils/endpoints.js";

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
    allWorkspaces.value = data.map((newWs) => {
      const existing = existingByName.get(newWs.name);
      if (!existing) return newWs;
      // 既存値をベースに、新値で nullish でないものだけ上書き。
      // last_commit_message のように /workspaces レスポンスに含まれない
      // 派生フィールドや、一時的に null になる branch を保護する。
      const merged = { ...existing };
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
    for (const status of data.statuses) {
      const ws = allWorkspaces.value.find((w) => w.name === status.name);
      if (!ws) continue;
      for (const [k, v] of Object.entries(status)) {
        if (v != null) ws[k] = v;
      }
    }
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
