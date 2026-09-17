import { computed, ref, watch, type Ref } from "vue";
import { useApi } from "./useApi.ts";
import { type AsyncState, asyncError, asyncIdle, asyncLoading, asyncReady, asyncValueOr } from "../utils/async-state.ts";

export type JobOption = { key: string, label: string };

/**
 * Dispatch 実行画面（DispatchRunView.vue）の Job / Branch セレクトの選択肢を、
 * 対象ワークスペースの変化に追従して取得する。
 * 取り直した結果に今の選択値が無ければ、Job は terminal、Base branch は空に戻す。
 */
export function useDispatchRunOptions(options: {
  jobWorkspace: Ref<string>,
  selectedJob: Ref<string>,
  branchWorkspace: Ref<string | undefined>,
  baseBranch: Ref<string>,
}) {
  const { apiGet, wsEndpoint } = useApi();

  const jobsState = ref<AsyncState<JobOption[]>>(asyncIdle());
  const jobs = computed(() => asyncValueOr(jobsState.value, [] as JobOption[]));
  const branchesState = ref<AsyncState<string[]>>(asyncIdle());
  const localBranches = computed(() => asyncValueOr(branchesState.value, [] as string[]));

  watch(options.jobWorkspace, async (ws) => {
    jobsState.value = asyncLoading();
    if (!ws) { jobsState.value = asyncReady([]); return; }
    const res = await apiGet(wsEndpoint(ws, "jobs"));
    jobsState.value = res.ok && res.data
      ? asyncReady(Object.entries(res.data as Record<string, any>).map(([key, def]) => ({ key, label: def.label || key })))
      : asyncError("Failed to load jobs");
    if (options.selectedJob.value !== "terminal" && !jobs.value.some((j) => j.key === options.selectedJob.value)) {
      options.selectedJob.value = "terminal";
    }
  }, { immediate: true });

  watch(options.branchWorkspace, async (ws) => {
    branchesState.value = asyncLoading();
    if (!ws) { branchesState.value = asyncReady([]); return; }
    const res = await apiGet(wsEndpoint(ws, "branches"));
    if (res.ok && Array.isArray(res.data)) {
      // 現在ブランチを一覧の先頭に出す（"(current branch)" プレースホルダーとは別に、
      // 実ブランチ名の並びの中でも現在ブランチがどこにあるか分かりやすくするため）。
      const current = res.data.find((b) => b.current);
      const rest = res.data.filter((b) => !b.current).map((b) => b.name);
      branchesState.value = asyncReady(current ? [current.name, ...rest] : rest);
    } else {
      branchesState.value = asyncError("Failed to load branches");
    }
    if (options.baseBranch.value && !localBranches.value.includes(options.baseBranch.value)) {
      options.baseBranch.value = "";
    }
  }, { immediate: true });

  return { jobsState, jobs, branchesState, localBranches };
}
