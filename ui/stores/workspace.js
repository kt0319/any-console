import { defineStore } from "pinia";
import { ref, computed } from "vue";

export const useWorkspaceStore = defineStore("workspace", () => {
  const allWorkspaces = ref([]);
  const selectedWorkspace = ref(null);
  const workspaceJobs = ref({});
  const workspaceJobsCache = ref({});
  const workspaceJobsLoadedFor = ref(null);
  const pendingJob = ref(null);
  const cachedBranches = ref([]);
  const isLaunchingTerminal = ref(false);
  const appInitializing = ref(false);

  const visibleWorkspaces = computed(() =>
    allWorkspaces.value.filter((ws) => !ws.hidden),
  );

  return {
    allWorkspaces,
    selectedWorkspace,
    workspaceJobs,
    workspaceJobsCache,
    workspaceJobsLoadedFor,
    pendingJob,
    cachedBranches,
    isLaunchingTerminal,
    appInitializing,
    visibleWorkspaces,
  };
});
