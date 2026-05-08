import { ref, onMounted } from "vue";
import { useGitHub } from "./useGitHub.js";

/**
 * @param {Function} loaderFn
 * @param {{ onLoaded?: (items: any[]) => void }} [opts]
 */
export function useGitHubPane(loaderFn, opts = {}) {
  const { onLoaded } = opts;
  const { githubUrl, loadWorkspaceGithubUrl } = useGitHub();
  const items = ref([]);
  const isLoading = ref(false);
  const error = ref("");

  async function reload() {
    loadWorkspaceGithubUrl();
    if (!githubUrl.value) return;
    await loaderFn(items, isLoading, error);
    onLoaded?.(items.value);
  }

  onMounted(reload);

  return { githubUrl, items, isLoading, error, reload };
}
