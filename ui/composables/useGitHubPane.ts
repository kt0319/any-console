import { ref, onMounted, type Ref } from "vue";
import { useGitHub } from "./useGitHub.ts";

type GitHubPaneLoader = (listRef: Ref<any[]>, loadingRef: Ref<boolean>, errorRef: Ref<string>) => Promise<void>;

export function useGitHubPane(loaderFn: GitHubPaneLoader, opts: { onLoaded?: (items: any[]) => void } = {}) {
  const { onLoaded } = opts;
  const { githubUrl, loadWorkspaceGitHubUrl } = useGitHub();
  const items = ref<any[]>([]);
  const isLoading = ref(false);
  const error = ref("");

  async function reload() {
    loadWorkspaceGitHubUrl();
    if (!githubUrl.value) return;
    await loaderFn(items, isLoading, error);
    onLoaded?.(items.value);
  }

  onMounted(reload);

  return { githubUrl, items, isLoading, error, reload };
}
