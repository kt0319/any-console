import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";

export function useWorkspace() {
  const store = useWorkspaceStore();
  const workspaceName = computed(() => store.selectedWorkspace);

  async function withWorkspace<T>(fn: (name: string) => T | Promise<T>): Promise<T | undefined> {
    const name = store.selectedWorkspace;
    if (!name) return undefined;
    return await fn(name);
  }

  function getWorkspace() {
    return store.selectedWorkspace;
  }

  return { workspaceName, withWorkspace, getWorkspace };
}
