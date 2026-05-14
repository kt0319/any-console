import { ref } from "vue";
import { useApi } from "./useApi.js";
import { EP_WORKSPACES_SUGGEST } from "../utils/endpoints.js";

const SUGGEST_DEBOUNCE_MS = 150;

export function useDirectorySuggest(addPath) {
  const { apiGet } = useApi();
  const suggestBase = ref("");
  const suggestEntries = ref([]);
  const suggestVisible = ref(false);
  let suggestTimer = null;

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

  function onSuggestClick(entry) {
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
