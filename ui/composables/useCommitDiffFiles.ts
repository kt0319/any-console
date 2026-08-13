import { ref } from "vue";

export function useCommitDiffFiles() {
  const selectedCommit = ref<Record<string, any> | null>(null);
  const files = ref<any[]>([]);
  const isLoading = ref(false);

  async function openDiffFiles(entry: Record<string, any>, fetchFn: () => Promise<any>) {
    selectedCommit.value = entry;
    files.value = [];
    isLoading.value = true;
    try {
      const result = await fetchFn();
      if (!result) return;
      files.value = result.fileList;
    } catch (e) {
      console.error("diff files load failed:", e);
    } finally {
      isLoading.value = false;
    }
  }

  function close() {
    selectedCommit.value = null;
    files.value = [];
  }

  return {
    selectedCommit, files, isLoading,
    openDiffFiles, close,
  };
}
