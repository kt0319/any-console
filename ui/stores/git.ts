import { defineStore } from "pinia";
import { ref } from "vue";
import { GIT_LOG_ENTRIES_PER_PAGE } from "../utils/constants.ts";

export function parseDiffChunks(diffText: string | null | undefined): Record<string, string> {
  const chunks: Record<string, string> = {};
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
  const diffChunks = ref<Record<string, string>>({});
  const diffFullText = ref("");
  const diffFileStatuses = ref<Record<string, string>>({});

  return {
    GIT_LOG_ENTRIES_PER_PAGE,
    diffChunks,
    diffFullText,
    diffFileStatuses,
  };
});
