// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { useSnippetCycle } from "../../ui/composables/useSnippetCycle.ts";
import { useInputStore } from "../../ui/stores/input.ts";

function setup({ snippets = [] } = {}) {
  setActivePinia(createPinia());
  const store = useInputStore();
  store.snippetsCache = [...snippets];

  const draft = ref("");
  const { snippetPrev, snippetNext } = useSnippetCycle(draft);
  return { draft, snippetPrev, snippetNext };
}

describe("useSnippetCycle: 途中入力の復元", () => {
  it("snippetPrev で先頭まで戻ると元の途中入力が復元される", () => {
    const { draft, snippetPrev, snippetNext } = setup({
      snippets: [{ label: "status", command: "git status" }, { label: "ls", command: "ls -la" }],
    });
    draft.value = "partial";
    snippetNext();
    expect(draft.value).toBe("git status");
    snippetNext();
    expect(draft.value).toBe("ls -la");
    snippetPrev();
    expect(draft.value).toBe("git status");
    snippetPrev();
    expect(draft.value).toBe("partial");
  });

  it("スニペットが無ければ何もしない", () => {
    const { draft, snippetPrev, snippetNext } = setup({ snippets: [] });
    draft.value = "partial";
    snippetNext();
    expect(draft.value).toBe("partial");
    snippetPrev();
    expect(draft.value).toBe("partial");
  });

  it("入力なし（空文字）の状態から辿っても復元で空文字に戻る", () => {
    const { draft, snippetPrev, snippetNext } = setup({
      snippets: [{ label: "diff", command: "git diff" }],
    });
    draft.value = "";
    snippetNext();
    expect(draft.value).toBe("git diff");
    snippetPrev();
    expect(draft.value).toBe("");
  });
});
