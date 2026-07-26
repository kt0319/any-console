// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { useInputDraftHistory } from "../../ui/composables/useInputDraftHistory.js";
import { useInputStore } from "../../ui/stores/input.js";

function setup({ history = [] } = {}) {
  setActivePinia(createPinia());
  const store = useInputStore();
  store.inputHistory = [...history];

  const draft = ref("");
  const { historyPrev, historyNext } = useInputDraftHistory(draft);
  return { draft, historyPrev, historyNext };
}

describe("useInputDraftHistory: 途中入力の復元", () => {
  it("historyNext で先頭まで戻ると元の途中入力が復元される", () => {
    const { draft, historyPrev, historyNext } = setup({ history: ["git status", "ls"] });
    draft.value = "partial";
    historyPrev();
    expect(draft.value).toBe("git status");
    historyPrev();
    expect(draft.value).toBe("ls");
    historyNext();
    expect(draft.value).toBe("git status");
    historyNext();
    expect(draft.value).toBe("partial");
  });

  it("入力なし（空文字）の状態から history を辿っても復元で空文字に戻る", () => {
    const { draft, historyPrev, historyNext } = setup({ history: ["git diff"] });
    draft.value = "";
    historyPrev();
    expect(draft.value).toBe("git diff");
    historyNext();
    expect(draft.value).toBe("");
  });
});
