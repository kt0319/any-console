import { ref } from "vue";
import { LS_KEY_RECENT_JOBS, RECENT_JOBS_MAX } from "../utils/constants.js";
import { EP_RECENT_JOBS } from "../utils/endpoints.js";
import { useConfirm } from "./useConfirm.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";
import { jobCommandPreview } from "../utils/format.js";

/** @type {import("vue").Ref<Record<string, unknown>[]>} */
const recentJobs = ref([]);
let loaded = false;

export function useRecentJobs() {
  const { confirm } = useConfirm();
  const { apiGet, apiPut } = useApi();

  // ピン留め済みを先頭にまとめ、そのあとを実行が新しい順にする。
  // 上限 RECENT_JOBS_MAX は非ピン留め分にのみ適用し、ピン留めは何件でも保持する。
  function _sortAndTrim(jobs) {
    const pinned = jobs.filter((j) => j.pinned);
    const unpinned = jobs.filter((j) => !j.pinned).slice(0, RECENT_JOBS_MAX);
    return [...pinned, ...unpinned];
  }

  // localStorage はサーバー未応答時のオフライン表示用キャッシュ。正はサーバー側の recent_jobs。
  function _save() {
    try {
      localStorage.setItem(LS_KEY_RECENT_JOBS, JSON.stringify(recentJobs.value));
    } catch { /* ignore */ }
  }

  async function _syncToServer() {
    const recent_jobs = recentJobs.value;
    await apiPut(EP_RECENT_JOBS, { recent_jobs }, { errorMessage: "Failed to save recent jobs" });
  }

  async function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = localStorage.getItem(LS_KEY_RECENT_JOBS);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) recentJobs.value = _sortAndTrim(parsed);
    } catch { /* ignore */ }

    const { ok, data } = await apiGet(EP_RECENT_JOBS);
    if (ok && Array.isArray(data?.recent_jobs)) {
      recentJobs.value = _sortAndTrim(data.recent_jobs);
      _save();
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
    _syncToServer();
  }

  async function togglePin(key) {
    const jobs = recentJobs.value.map((j) => (j.key === key ? { ...j, pinned: !j.pinned } : j));
    recentJobs.value = _sortAndTrim(jobs);
    _save();
    await _syncToServer();
  }

  /** Recent Jobs 一覧から選んだジョブをターミナルとして起動する。 */
  async function runRecentJob(recent) {
    if (recent.jobConfirm !== false) {
      const preview = jobCommandPreview(recent.jobCommand, recent.jobName);
      if (!await confirm(`${recent.jobLabel || recent.jobName}\n\n${preview}`)) return;
    }
    // ワークスペースを開いてもサイドバー/設定は閉じない（WorkspaceJobsPane.vue
    // のopenTerminal/runJobと同様）。
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
