import { defineStore } from "pinia";
import { ref, computed } from "vue";

export const useWorkspaceStore = defineStore("workspace", () => {
  const allWorkspaces = ref([]);
  const selectedWorkspace = ref(null);
  const workspaceJobs = ref({});
  const workspaceJobsCache = ref({});
  const workspaceJobsLoadedFor = ref(null);
  const pendingJob = ref(null);
  const branchesCache = ref([]);
  const isLaunchingTerminal = ref(false);
  const appInitializing = ref(false);

  const visibleWorkspaces = computed(() =>
    allWorkspaces.value.filter((ws) => !ws.hidden),
  );

  async function fetchStatuses(auth) {
    try {
      const res = await auth.apiFetch("/workspaces/statuses");
      if (!res || !res.ok) return;
      const data = await res.json();
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
    workspaceJobsCache,
    workspaceJobsLoadedFor,
    pendingJob,
    branchesCache,
    isLaunchingTerminal,
    appInitializing,
    visibleWorkspaces,
    fetchStatuses,
  };
});
