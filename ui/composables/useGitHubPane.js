import { ref, onMounted } from "vue";
import { useGitHub } from "./useGitHub.js";

export function useGitHubPane(loaderFn, { onLoaded } = {}) {
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
