import { ref } from "vue";
import { LS_KEY_RECENT_JOBS } from "../utils/constants.js";
import { useConfirm } from "./useConfirm.js";
import { emit } from "../app-bridge.js";

const MAX_RECENT = 8;

/** @type {import("vue").Ref<Record<string, unknown>[]>} */
const recentJobs = ref([]);
let loaded = false;

export function useRecentJobs() {
  const { confirm } = useConfirm();

  // ピン留め済みを先頭にまとめ、そのあとを実行が新しい順にする。
  // 上限 MAX_RECENT は非ピン留め分にのみ適用し、ピン留めは何件でも保持する。
  function _sortAndTrim(jobs) {
    const pinned = jobs.filter((j) => j.pinned);
    const unpinned = jobs.filter((j) => !j.pinned).slice(0, MAX_RECENT);
    return [...pinned, ...unpinned];
  }

  function _save() {
    try {
      localStorage.setItem(LS_KEY_RECENT_JOBS, JSON.stringify(recentJobs.value));
    } catch { /* ignore */ }
  }

  function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = localStorage.getItem(LS_KEY_RECENT_JOBS);
      const parsed = raw ? JSON.parse(raw) : [];
      recentJobs.value = Array.isArray(parsed) ? _sortAndTrim(parsed) : [];
    } catch {
      recentJobs.value = [];
    }
  }

  function recordJob(ws, job) {
    const key = `${ws.name}:${job.name}`;
    const existing = recentJobs.value.find((j) => j.key === key);
    const item = {
      key,
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
      pinned: existing?.pinned || false,
    };
    const rest = recentJobs.value.filter((j) => j.key !== key);
    recentJobs.value = _sortAndTrim([item, ...rest]);
    _save();
  }

  function togglePin(key) {
    const jobs = recentJobs.value.map((j) => (j.key === key ? { ...j, pinned: !j.pinned } : j));
    recentJobs.value = _sortAndTrim(jobs);
    _save();
  }

  /** Recent Jobs 一覧から選んだジョブをターミナルとして起動する。 */
  async function runRecentJob(recent) {
    if (recent.jobConfirm !== false) {
      const preview = recent.jobCommand
        ? (recent.jobCommand.length > 300 ? recent.jobCommand.slice(0, 300) + "..." : recent.jobCommand)
        : recent.jobName;
      if (!await confirm(`${recent.jobLabel || recent.jobName}\n\n${preview}`)) return;
    }
    emit("terminal:launch", {
      workspace: recent.workspace,
      icon: recent.wsIcon,
      iconColor: recent.wsIconColor,
      jobName: recent.jobName,
      jobLabel: recent.jobLabel,
      jobIcon: recent.jobIcon,
      jobIconColor: recent.jobIconColor,
      initialCommand: recent.jobCommand,
      detached: !!recent.jobDetachedTab,
    });
  }

  return { recentJobs, loadRecentJobs, recordJob, runRecentJob, togglePin };
}
