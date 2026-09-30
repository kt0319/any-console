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
  const { apiGet, apiPut, wsEndpoint } = useApi();

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

  // PUTをawaitせず連打すると、後発のリクエストが先に完了して古い並び順で
  // サーバー側を上書きしてしまうことがある（実行順とレスポンス順が一致しない
  // ネットワークの逆転）。同時に1本しか投げないようにし、既に送信中なら
  // その完了を待ってから次を送る（先頭の呼び出しは同期的にすぐ送る）。
  let _inFlight: Promise<unknown> | null = null;
  function _syncToServer() {
    const recent_jobs = recentJobs.value;
    const send = () => apiPut(EP_RECENT_JOBS, { recent_jobs }, { errorMessage: "Failed to save recent jobs" });
    const run = _inFlight ? _inFlight.then(send, send) : send();
    _inFlight = run.finally(() => {
      if (_inFlight === run) _inFlight = null;
    });
    return _inFlight;
  }

  async function loadRecentJobs() {
    if (loaded) return;
    loaded = true;
    const parsed = safeJsonLoad(LS_KEY_RECENT_JOBS, []);
    if (Array.isArray(parsed)) recentJobs.value = _sortAndTrim(parsed);

    const { ok, data } = await apiGet(EP_RECENT_JOBS);
    if (ok && Array.isArray(data?.recent_jobs)) {
      recentJobs.value = _sortAndTrim(data.recent_jobs);
      _save();
    }
  }

  // 実行したジョブを一覧の先頭（ピン留めグループの直後）へ移動する。
  // 新規記録（recordJob）・既存項目の再実行（runRecentJob）の両方で使う共通処理。
  // ピン留め済み項目は起動しても並び順を変えない（手動で並べた順を保持するため）。
  function _touch(item: RecentJob) {
    let jobs;
    if (item.pinned) {
      jobs = recentJobs.value.map((j) => (j.key === item.key ? item : j));
    } else {
      const rest = recentJobs.value.filter((j) => j.key !== item.key);
      jobs = [item, ...rest];
    }
    recentJobs.value = _sortAndTrim(jobs);
    _save();
    _syncToServer();
  }

  function recordJob(
    ws: Record<string, any>,
    job: { name: string, label?: string, icon?: string, icon_color?: string, command?: string, confirm?: boolean, detached?: boolean },
  ) {
    const key = `${ws.name}:${job.name}`;
    const existing = recentJobs.value.find((j) => j.key === key);
    _touch({
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
    });
  }

  async function togglePin(key: string) {
    const target = recentJobs.value.find((j) => j.key === key);
    if (!target) return;
    const pinned = !target.pinned;
    const updated = { ...target, pinned };
    let jobs;
    if (pinned) {
      // ピン留め時はピン留めグループの先頭に来るよう配列の先頭へ移動する。
      jobs = [updated, ...recentJobs.value.filter((j) => j.key !== key)];
    } else {
      // ピン解除時は位置を変えない。
      jobs = recentJobs.value.map((j) => (j.key === key ? updated : j));
    }
    recentJobs.value = _sortAndTrim(jobs);
    _save();
    await _syncToServer();
  }

  async function removeRecentJob(key: string) {
    recentJobs.value = recentJobs.value.filter((j) => j.key !== key);
    _save();
    await _syncToServer();
  }

  /**
   * Recent Jobs 一覧から選んだジョブをターミナルとして起動する。
   * 保存済みの jobCommand は記録時点のスナップショットで古びる可能性があるため、
   * 起動直前にワークスペースの現在のジョブ定義を取り直して上書きする
   * （ジョブが改名・削除されていた場合はスナップショットのまま実行する）。
   */
  async function runRecentJob(recent: RecentJob) {
    const { ok, data } = await apiGet(wsEndpoint(recent.workspace, "jobs"));
    const latest = ok ? data?.[recent.jobName] : null;
    const current = latest
      ? {
          ...recent,
          jobLabel: latest.label || "",
          jobIcon: latest.icon || "",
          jobIconColor: latest.icon_color || "",
          jobCommand: latest.command || "",
          jobConfirm: latest.confirm ?? null,
          jobDetached: !!latest.detached,
        }
      : recent;

    if (current.jobConfirm !== false) {
      const preview = jobCommandPreview(current.jobCommand, current.jobName);
      if (!await confirm(`${current.jobLabel || current.jobName}\n\n${preview}`)) return;
    }
    // 再実行時も最新実行として先頭へ移動する（recordJobと同じ並び替え）。
    // 取り直した最新定義で保存内容も更新しておく。
    _touch(current);
    // ワークスペースを開いてもサイドバー/設定は閉じない（WorkspaceJobsPane.vue
    // のopenTerminal/runJobと同様）。
    emit("terminal:launch", {
      workspace: current.workspace,
      icon: current.wsIcon,
      iconColor: current.wsIconColor,
      jobName: current.jobName,
      jobLabel: current.jobLabel,
      jobIcon: current.jobIcon,
      jobIconColor: current.jobIconColor,
      initialCommand: current.jobCommand,
      detached: !!current.jobDetached,
    });
  }

  return { recentJobs, loadRecentJobs, recordJob, runRecentJob, togglePin, removeRecentJob };
}
