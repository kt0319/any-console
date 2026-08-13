import { ref, type Ref } from "vue";
import { useApi } from "./useApi.ts";
import { EP_WORKSPACES_SUGGEST } from "../utils/endpoints.ts";
import { DIRECTORY_SUGGEST_DEBOUNCE_MS as SUGGEST_DEBOUNCE_MS } from "../utils/constants.ts";

type SuggestEntry = { path: string, name?: string, registered?: boolean };

export function useDirectorySuggest(addPath: Ref<string>) {
  const { apiGet } = useApi();
  const suggestBase = ref("");
  const suggestEntries = ref<SuggestEntry[]>([]);
  const suggestVisible = ref(false);
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;

  function loadSuggest() {
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      try {
        const url = `${EP_WORKSPACES_SUGGEST}?path=${encodeURIComponent(addPath.value)}`;
        const { ok, data } = await apiGet(url);
        if (ok && data) {
          suggestBase.value = data.base || "";
          suggestEntries.value = data.entries || [];
          if (!addPath.value && suggestBase.value) {
            addPath.value = suggestBase.value.endsWith("/")
              ? suggestBase.value
              : `${suggestBase.value}/`;
          }
        } else {
          suggestEntries.value = [];
        }
      } catch {
        suggestEntries.value = [];
      }
    }, SUGGEST_DEBOUNCE_MS);
  }

  function onInputFocus() {
    suggestVisible.value = true;
    loadSuggest();
  }

  function onInputBlur() {
    suggestVisible.value = false;
  }

  function onSuggestClick(entry: SuggestEntry) {
    if (entry.registered) return;
    addPath.value = entry.path;
    suggestVisible.value = true;
    loadSuggest();
  }

  return {
    suggestBase,
    suggestEntries,
    suggestVisible,
    loadSuggest,
    onInputFocus,
    onInputBlur,
    onSuggestClick,
  };
}
