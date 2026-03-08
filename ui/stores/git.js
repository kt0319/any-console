import { defineStore } from "pinia";
import { ref } from "vue";

export const useGitStore = defineStore("git", () => {
  const GIT_LOG_ENTRIES_PER_PAGE = 30;
  const diffChunks = ref({});
  const diffFullText = ref("");

  return {
    GIT_LOG_ENTRIES_PER_PAGE,
    diffChunks,
    diffFullText,
  };
});
