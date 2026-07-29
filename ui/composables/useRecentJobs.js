import { ref } from "vue";
import { LS_KEY_RECENT_JOBS, RECENT_JOBS_MAX } from "../utils/constants.js";
import { EP_PINNED_JOBS } from "../utils/endpoints.js";
import { useConfirm } from "./useConfirm.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";

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

  function _save() {
    try {
      localStorage.setItem(LS_KEY_RECENT_JOBS, JSON.stringify(recentJobs.value));
    } catch { /* ignore */ }
  }

  /** ピン留め済みジョブ一覧をサーバーへ保存する。 */
  async function _syncPinnedToServer() {
    const pinned_jobs = recentJobs.value
      .filter((j) => j.pinned)
      .map(({ pinned: _pinned, ...rest }) => rest);
    await apiPut(EP_PINNED_JOBS, { pinned_jobs }, { errorMessage: "Failed to save pinned job" });
  }

  async function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    let local = [];
    try {
      const raw = localStorage.getItem(LS_KEY_RECENT_JOBS);
      const parsed = raw ? JSON.parse(raw) : [];
      local = Array.isArray(parsed) ? parsed : [];
    } catch {
      local = [];
    }

    const { ok, data } = await apiGet(EP_PINNED_JOBS);
    const serverPinned = ok && Array.isArray(data?.pinned_jobs) ? data.pinned_jobs : [];
    const serverKeys = new Set(serverPinned.map((j) => j.key));

    // サーバーのピン留めを正とし、ローカル履歴とマージする（ローカルのみのピン留めは移行対象として残す）。
    const merged = new Map(local.map((j) => [j.key, { ...j }]));
    for (const item of serverPinned) merged.set(item.key, { ...item, pinned: true });
    recentJobs.value = _sortAndTrim([...merged.values()]);
    _save();

    // 移行: サーバー導入前にローカルのみでピン留めされていた分をサーバーへ反映する。
    const hasLocalOnlyPin = local.some((j) => j.pinned && !serverKeys.has(j.key));
    if (hasLocalOnlyPin) await _syncPinnedToServer();
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

  async function togglePin(key) {
    const jobs = recentJobs.value.map((j) => (j.key === key ? { ...j, pinned: !j.pinned } : j));
    recentJobs.value = _sortAndTrim(jobs);
    _save();
    await _syncPinnedToServer();
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
    emit("modal:close");
  }

  return { recentJobs, loadRecentJobs, recordJob, runRecentJob, togglePin };
}
