import { ref } from "vue";
import { LS_KEY_RECENT_JOBS, RECENT_JOBS_MAX } from "../utils/constants.ts";
import { EP_RECENT_JOBS } from "../utils/endpoints.ts";
import { useConfirm } from "./useConfirm.ts";
import { useApi } from "./useApi.ts";
import { emit } from "../app-bridge.ts";
import { jobCommandPreview } from "../utils/format.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";

/** Recent Jobs の1項目（サーバー側 recent_jobs / localStorage キャッシュと同形）。 */
interface RecentJob {
  key: string;
  workspace: string;
  wsIcon: string;
  wsIconColor: string;
  jobName: string;
  jobLabel: string;
  jobIcon: string;
  jobIconColor: string;
  jobCommand: string;
  jobConfirm: boolean | null;
  jobDetached: boolean;
  pinned: boolean;
}

const recentJobs = ref<RecentJob[]>([]);
let loaded = false;

export function useRecentJobs() {
  const { confirm } = useConfirm();
  const { apiGet, apiPut } = useApi();

  // ピン留め済みを先頭にまとめ、そのあとを実行が新しい順にする。
  // 上限 RECENT_JOBS_MAX は非ピン留め分にのみ適用し、ピン留めは何件でも保持する。
  function _sortAndTrim(jobs: RecentJob[]) {
    const pinned = jobs.filter((j) => j.pinned);
    const unpinned = jobs.filter((j) => !j.pinned).slice(0, RECENT_JOBS_MAX);
    return [...pinned, ...unpinned];
  }

  // localStorage はサーバー未応答時のオフライン表示用キャッシュ。正はサーバー側の recent_jobs。
  function _save() {
    safeJsonSave(LS_KEY_RECENT_JOBS, recentJobs.value);
  }

  async function _syncToServer() {
    const recent_jobs = recentJobs.value;
    await apiPut(EP_RECENT_JOBS, { recent_jobs }, { errorMessage: "Failed to save recent jobs" });
  }

  // v4 リネーム（jobDetachedTab → jobDetached）の過渡期対応: 旧バンドルが
  // 書いた localStorage キャッシュや旧バックエンドの応答には jobDetachedTab が
  // 残っているため、読み込み時に新キーへ正規化する（サーバー要求が完了する前・
  // 失敗時はキャッシュのまま起動経路に乗るため、ここで揃えないと detached
  // 指定が落ちる）。旧データが淘汰されたら削除してよい。
  function _normalizeLegacy(job: Record<string, any>): RecentJob {
    if (job && job.jobDetachedTab !== undefined) {
      // 両キー併存（サーバーの GET 応答は過渡期ミラーとして両方を載せる）でも
      // legacy キーは常に落とし、新キーが明示されていればそちらを正とする。
      const { jobDetachedTab, ...rest } = job;
      const jobDetached = rest.jobDetached !== undefined ? !!rest.jobDetached : !!jobDetachedTab;
      return { ...rest, jobDetached } as RecentJob;
    }
    return job as RecentJob;
  }

  async function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    const parsed = safeJsonLoad(LS_KEY_RECENT_JOBS, []);
    if (Array.isArray(parsed)) recentJobs.value = _sortAndTrim(parsed.map(_normalizeLegacy));

    const { ok, data } = await apiGet(EP_RECENT_JOBS);
    if (ok && Array.isArray(data?.recent_jobs)) {
      recentJobs.value = _sortAndTrim(data.recent_jobs.map(_normalizeLegacy));
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
      jobConfirm: job.confirm ?? null,
      jobDetached: !!job.detached,
      pinned: existing?.pinned || false,
    };
    const rest = recentJobs.value.filter((j) => j.key !== key);
    recentJobs.value = _sortAndTrim([item, ...rest]);
    _save();
    _syncToServer();
  }

  async function togglePin(key: string) {
    const jobs = recentJobs.value.map((j) => (j.key === key ? { ...j, pinned: !j.pinned } : j));
    recentJobs.value = _sortAndTrim(jobs);
    _save();
    await _syncToServer();
  }

  async function removeRecentJob(key: string) {
    recentJobs.value = recentJobs.value.filter((j) => j.key !== key);
    _save();
    await _syncToServer();
  }

  /** Recent Jobs 一覧から選んだジョブをターミナルとして起動する。 */
  async function runRecentJob(recent: RecentJob) {
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
      detached: !!recent.jobDetached,
    });
  }

  return { recentJobs, loadRecentJobs, recordJob, runRecentJob, togglePin, removeRecentJob };
}
