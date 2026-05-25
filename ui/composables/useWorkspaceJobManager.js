import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.js";
import { useToast } from "./useToast.js";
import { emit } from "../app-bridge.js";
import { EP_COMMON_JOBS } from "../utils/endpoints.js";

export function useWorkspaceJobManager({ editWs, pushView }) {
  const { apiGet, apiDelete, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const toast = useToast();
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
    } finally {
      isLoadingJobs.value = false;
    }
  }

  function startAddJob(isCommon = false) {
    pushView("JobConfig", {
      workspaceName: editWs.value.name,
      isCommon,
      jobEntry: null,
      onReturn: () => emit("jobs:refresh"),
    });
  }

  function startEditJob(entry) {
    pushView("JobConfig", {
      workspaceName: editWs.value.name,
      isCommon: !!entry.job.common,
      jobEntry: entry,
      onReturn: () => emit("jobs:refresh"),
    });
  }

  async function deleteJob(entry) {
    if (!editWs.value) return;
    const label = entry.job.label || entry.name;
    const kind = entry.job.common ? "common job" : "job";
    if (!await confirmIrreversible(confirm, `Delete ${kind} "${label}"?`)) return;
    try {
      const url = entry.job.common
        ? `${EP_COMMON_JOBS}/${encodeURIComponent(entry.name)}`
        : wsEndpoint(editWs.value.name, `jobs/${encodeURIComponent(entry.name)}`);
      const { ok } = await apiDelete(url, { errorMessage: "Delete job failed" });
      if (!ok) return;
      await loadWorkspaceJobs();
      emit("jobs:refresh");
    } catch {
      toast.error("Delete job failed");
    }
  }

  return { jobEntries, isLoadingJobs, loadWorkspaceJobs, startAddJob, startEditJob, deleteJob };
}
