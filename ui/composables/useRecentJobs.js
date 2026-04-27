import { ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { EP_RECENT_JOBS } from "../utils/endpoints.js";

const MAX_RECENT = 5;

const recentJobs = ref([]);
let loaded = false;

export function useRecentJobs() {
  const auth = useAuthStore();

  async function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await auth.apiFetch(EP_RECENT_JOBS);
      if (res?.ok) {
        const data = await res.json();
        recentJobs.value = (data.jobs || []).slice(0, MAX_RECENT);
      }
    } catch { /* ignore */ }
  }

  async function recordJob(ws, job) {
    const item = {
      key: `${ws.name}:${job.name}`,
      workspace: ws.name,
      wsIcon: ws.icon || "",
      wsIconColor: ws.icon_color || "",
      jobName: job.name,
      jobLabel: job.label || "",
      jobIcon: job.icon || "",
      jobIconColor: job.icon_color || "",
      jobCommand: job.command || "",
      jobConfirm: job.confirm ?? null,
      jobHiddenTab: !!job.hidden_tab,
    };
    try {
      const res = await auth.apiFetch(EP_RECENT_JOBS, {
        method: "POST",
        body: item,
      });
      if (res?.ok) {
        const data = await res.json();
        recentJobs.value = (data.jobs || []).slice(0, MAX_RECENT);
      }
    } catch { /* ignore */ }
  }

  return { recentJobs, loadRecentJobs, recordJob };
}
