import { ref } from "vue";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";

export function useWorkspaceJobManager({ editWs, pushView }) {
  const { apiGet, apiDelete, wsEndpoint } = useApi();
  const jobEntries = ref([]);
  const isLoadingJobs = ref(false);

  async function loadWorkspaceJobs() {
    if (!editWs.value) return;
    isLoadingJobs.value = true;
    try {
      const { ok, data } = await apiGet(wsEndpoint(editWs.value.name, "jobs"));
      if (ok) {
        jobEntries.value = Object.entries(data)
          .filter(([name]) => name !== "terminal")
          .map(([name, job]) => ({ name, job }));
      }
    } catch { /* ignore */ }
    finally { isLoadingJobs.value = false; }
  }

  function startAddJob() {
    const wsName = editWs.value.name;
    pushView("JobConfig", {
      workspaceName: wsName,
      jobEntry: null,
      onReturn: (_result, parentEntry) => {
        if (parentEntry) parentEntry.state.initialWsName = wsName;
        emit("jobs:refresh");
      },
    });
  }

  function startEditJob(entry) {
    const wsName = editWs.value.name;
    pushView("JobConfig", {
      workspaceName: wsName,
      jobEntry: entry,
      onReturn: (_result, parentEntry) => {
        if (parentEntry) parentEntry.state.initialWsName = wsName;
        emit("jobs:refresh");
      },
    });
  }

  async function deleteJob(entry) {
    if (!editWs.value) return;
    try {
      const { ok } = await apiDelete(wsEndpoint(editWs.value.name, `jobs/${encodeURIComponent(entry.name)}`), { errorMessage: "Delete job failed" });
      if (!ok) return;
      await loadWorkspaceJobs();
      emit("jobs:refresh");
    } catch {
      emit("toast:show", { message: "Delete job failed", type: "error" });
    }
  }

  return { jobEntries, isLoadingJobs, loadWorkspaceJobs, startAddJob, startEditJob, deleteJob };
}
