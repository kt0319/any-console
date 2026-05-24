import { reactive } from "vue";
import { useApi } from "./useApi.js";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.js";

export function useWorkspaceJobsList() {
  const { apiGet } = useApi();
  const commonJobs = reactive({});
  const localJobs = reactive({});

  async function loadJobs(workspaces) {
    try {
      const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
      if (!ok) return;
      for (const ws of workspaces) {
        const jobs = data[ws.name] || {};
        const all = Object.entries(jobs)
          .filter(([name]) => name !== "terminal")
          .map(([name, job]) => ({ name, ...job }));
        commonJobs[ws.name] = all.filter((j) => j.common);
        localJobs[ws.name] = all.filter((j) => !j.common);
      }
    } catch {
      // ignore
    }
  }

  return { commonJobs, localJobs, loadJobs };
}
