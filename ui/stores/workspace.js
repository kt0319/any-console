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
    if (ok) allWorkspaces.value = Array.isArray(data) ? data : [];
  }

  async function fetchStatuses() {
    const { ok, data } = await _safeFetch(EP_WORKSPACES_STATUSES);
    if (!ok) return;
    if (data?.statuses) {
      for (const status of data.statuses) {
        const ws = allWorkspaces.value.find((w) => w.name === status.name);
        if (ws) Object.assign(ws, status);
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
