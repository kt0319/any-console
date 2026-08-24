import { watch, type Ref } from "vue";
import { useInputStore } from "../stores/input.ts";

// useInputDraftHistory.ts（↑↓での履歴移動）とは異なり、スニペットは「時間を
// 遡る」対象ではなく単純な一覧なので、next=一覧を前進、prev=一覧を後退（→
// 元の途中入力へ復元）という直感的な向きで定義する。
export function useSnippetCycle(draft: Ref<string>) {
  const inputStore = useInputStore();

  let snippetIndex = -1;
  // スニペット巡回開始前の途中入力（巡回を抜けたときに復元する）
  let savedSnippetDraft = "";

  watch(draft, (val) => {
    if (val === "") snippetIndex = -1;
  });

  function snippetNext() {
    const list = inputStore.snippetsCache;
    if (!list.length) return;
    if (snippetIndex === -1) savedSnippetDraft = draft.value;
    snippetIndex = Math.min(snippetIndex + 1, list.length - 1);
    draft.value = list[snippetIndex].command;
  }

  function snippetPrev() {
    if (snippetIndex === -1) return;
    snippetIndex -= 1;
    if (snippetIndex < 0) {
      snippetIndex = -1;
      draft.value = savedSnippetDraft;
      return;
    }
    draft.value = inputStore.snippetsCache[snippetIndex].command;
  }

  return { snippetPrev, snippetNext };
}
