import { useInputStore } from "../stores/input.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";
import { EP_SNIPPETS } from "../utils/endpoints.js";

export function useSnippetPersist() {
  const inputStore = useInputStore();
  const { apiGet, apiPut } = useApi();

  async function loadSnippetCache() {
    if (inputStore.isSnippetsLoaded) return;
    try {
      const { ok, data } = await apiGet(EP_SNIPPETS);
      if (!ok) return;
      inputStore.snippetsCache = data.snippets || [];
      inputStore.isSnippetsLoaded = true;
    } catch {}
  }

  async function persistSnippets() {
    await apiPut(EP_SNIPPETS, { snippets: inputStore.snippetsCache }, { errorMessage: "Failed to save snippets" });
  }

  function moveSnippetToFront(command) {
    const idx = inputStore.snippetsCache.findIndex((s) => s.command === command);
    if (idx === -1) return;
    const next = [...inputStore.snippetsCache];
    const [snippet] = next.splice(idx, 1);
    next.push(snippet);
    inputStore.snippetsCache = next;
    persistSnippets();
  }

  async function addSnippet(label, command) {
    const lbl = label || (command.length > 40 ? command.slice(0, 40) : command);
    inputStore.snippetsCache.push({ label: lbl, command });
    await persistSnippets();
  }

  async function deleteSnippet(index) {
    if (index >= 0 && index < inputStore.snippetsCache.length) {
      inputStore.snippetsCache.splice(index, 1);
      await persistSnippets();
    }
  }

  async function moveSnippet(from, to) {
    const cache = inputStore.snippetsCache;
    if (from < 0 || from >= cache.length || to < 0 || to >= cache.length) return;
    const next = [...cache];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    inputStore.snippetsCache = next;
    await persistSnippets();
  }

  return { loadSnippetCache, persistSnippets, moveSnippetToFront, addSnippet, deleteSnippet, moveSnippet };
}
