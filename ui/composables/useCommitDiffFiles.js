import { ref } from "vue";

export function useCommitDiffFiles() {
  const selectedCommit = ref(null);
  const files = ref([]);
  const isLoading = ref(false);

  async function openDiffFiles(entry, fetchFn) {
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
