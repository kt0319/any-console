import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";

export function useWorkspace() {
  const store = useWorkspaceStore();
  const workspaceName = computed(() => store.selectedWorkspace);

  async function withWorkspace(fn) {
    const name = store.selectedWorkspace;
    if (!name) return undefined;
    return await fn(name);
  }

  function getWorkspace() {
    return store.selectedWorkspace;
  }

  return { workspaceName, withWorkspace, getWorkspace };
}
