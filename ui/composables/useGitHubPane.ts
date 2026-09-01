import { shallowRef, computed, onMounted, type Ref } from "vue";
import { useGitHub } from "./useGitHub.ts";
import { type AsyncState, asyncIdle, asyncValueOr, isAsyncPending } from "../utils/async-state.ts";

type GitHubPaneLoader<T> = (stateRef: Ref<AsyncState<T[]>>) => Promise<void>;

export function useGitHubPane<T>(loaderFn: GitHubPaneLoader<T>, opts: { onLoaded?: (items: T[]) => void } = {}) {
  const { onLoaded } = opts;
  const { githubUrl, loadWorkspaceGitHubUrl } = useGitHub();
  const state = shallowRef<AsyncState<T[]>>(asyncIdle());
  const items = computed(() => asyncValueOr(state.value, [] as T[]));
  const isLoading = computed(() => isAsyncPending(state.value));
  const error = computed(() => (state.value.status === "error" ? state.value.error : ""));

  async function reload() {
    loadWorkspaceGitHubUrl();
    if (!githubUrl.value) return;
    await loaderFn(state);
    onLoaded?.(items.value);
  }

  onMounted(reload);

  return { githubUrl, items, isLoading, error, reload };
}
