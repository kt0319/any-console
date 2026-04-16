import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "../composables/useApi.js";

export const useWorkspaceStore = defineStore("workspace", () => {
  const allWorkspaces = ref([]);
  const selectedWorkspace = ref(null);
  const workspaceJobs = ref({});
  const pendingJob = ref(null);
  const branchesCache = ref([]);
  const isLaunchingTerminal = ref(false);
  const appInitializing = ref(false);

  const visibleWorkspaces = computed(() =>
    allWorkspaces.value.filter((ws) => !ws.hidden),
  );

  const currentWorkspace = computed(() =>
    allWorkspaces.value.find((w) => w.name === selectedWorkspace.value),
  );

  async function fetchWorkspaces() {
    try {
      const { apiGet } = useApi();
      const { ok, data } = await apiGet("/workspaces");
      if (ok) {
        allWorkspaces.value = Array.isArray(data) ? data : [];
      }
    } catch {
      // ignore
    }
  }

  async function fetchStatuses() {
    try {
      const { apiGet } = useApi();
      const { ok, data } = await apiGet("/workspaces/statuses");
      if (!ok) return;
      if (data.statuses) {
        for (const status of data.statuses) {
          const ws = allWorkspaces.value.find((w) => w.name === status.name);
          if (ws) Object.assign(ws, status);
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    allWorkspaces,
    selectedWorkspace,
    workspaceJobs,
    pendingJob,
    branchesCache,
    isLaunchingTerminal,
    appInitializing,
    visibleWorkspaces,
    currentWorkspace,
    fetchWorkspaces,
    fetchStatuses,
  };
});
