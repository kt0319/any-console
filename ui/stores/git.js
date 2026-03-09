import { defineStore } from "pinia";
import { ref } from "vue";

export function parseDiffChunks(diffText) {
  const chunks = {};
  if (!diffText) return chunks;
  const parts = diffText.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const match = part.match(/^a\/(.+?)\s+b\/(.+)/);
    const path = match ? match[2] : null;
    if (path) {
      chunks[path] = "diff --git " + part;
    }
  }
  return chunks;
}

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
