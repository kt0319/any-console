import { ref } from "vue";
import { LS_KEY_RECENT_JOBS } from "../utils/constants.js";

const MAX_RECENT = 8;

/** @type {import("vue").Ref<Record<string, unknown>[]>} */
const recentJobs = ref([]);
let loaded = false;

export function useRecentJobs() {
  function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = localStorage.getItem(LS_KEY_RECENT_JOBS);
      recentJobs.value = raw ? JSON.parse(raw).slice(0, MAX_RECENT) : [];
    } catch {
      recentJobs.value = [];
    }
  }

  function recordJob(ws, job) {
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
      jobUrl: job.url || "",
      jobType: job.type || "command",
      jobConfirm: job.confirm ?? null,
      jobDetachedTab: !!job.detached_tab,
    };
    const jobs = recentJobs.value.filter((j) => j.key !== item.key);
    jobs.unshift(item);
    recentJobs.value = jobs.slice(0, MAX_RECENT);
    try {
      localStorage.setItem(LS_KEY_RECENT_JOBS, JSON.stringify(recentJobs.value));
    } catch { /* ignore */ }
  }

  return { recentJobs, loadRecentJobs, recordJob };
}
