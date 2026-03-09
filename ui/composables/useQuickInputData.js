import { computed } from "vue";
import { useInputStore } from "../stores/input.js";

export function useQuickInputData() {
  const inputStore = useInputStore();

  const snippets = computed(() =>
    inputStore.snippetsCache ? [...inputStore.snippetsCache].reverse() : [],
  );

  const history = computed(() =>
    inputStore.inputHistory ? [...inputStore.inputHistory] : [],
  );

  function truncateQuickText(text) {
    return text && text.length > 20 ? `${text.slice(0, 20)}\u2026` : text || "";
  }

  return {
    snippets,
    history,
    truncateQuickText,
  };
}
