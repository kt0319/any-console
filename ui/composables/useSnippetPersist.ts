import { useInputStore } from "../stores/input.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { emit } from "../app-bridge.ts";
import { EP_SNIPPETS } from "../utils/endpoints.ts";

export function useSnippetPersist() {
  const inputStore = useInputStore();
  const { apiGet, apiPut } = useApi();

  async function loadSnippetCache() {
    if (inputStore.isSnippetsLoaded) return;
    try {
      const { ok, data } = await getWithRetry(apiGet, EP_SNIPPETS);
      if (!ok) return;
      inputStore.snippetsCache = data.snippets || [];
      inputStore.isSnippetsLoaded = true;
    } catch {}
  }

  async function persistSnippets() {
    await apiPut(EP_SNIPPETS, { snippets: inputStore.snippetsCache }, { errorMessage: "Failed to save snippets" });
  }

  async function addSnippet(label: string, command: string) {
    const lbl = label || (command.length > 40 ? command.slice(0, 40) : command);
    inputStore.snippetsCache.push({ label: lbl, command });
    await persistSnippets();
  }

  async function deleteSnippet(index: number) {
    if (index >= 0 && index < inputStore.snippetsCache.length) {
      inputStore.snippetsCache.splice(index, 1);
      await persistSnippets();
    }
  }

  return { loadSnippetCache, persistSnippets, addSnippet, deleteSnippet };
}
