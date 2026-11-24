import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { useBusListener } from "./useBusListener.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { EP_COMMON_JOBS } from "../utils/endpoints.ts";
import type { RunnableJob } from "./useRunJob.ts";

// 共通ジョブのうち default: true の1件（無ければ null）。Open Session でワークスペースを
// タップした時の直接起動に使う。jobs:refresh（ジョブの追加・編集・削除後）で再取得する。
const defaultJob = ref<RunnableJob | null>(null);

export function useDefaultJob() {
  const { apiGet } = useApi();

  async function loadDefaultJob() {
    const { ok, data } = await getWithRetry(apiGet, EP_COMMON_JOBS);
    if (!ok) return;
    const entry = Object.entries(data as Record<string, Omit<RunnableJob, "name"> & { default?: boolean }>)
      .find(([, job]) => job.default);
    defaultJob.value = entry ? { name: entry[0], ...entry[1] } : null;
  }

  useBusListener("jobs:refresh", loadDefaultJob);

  return { defaultJob, loadDefaultJob };
}
