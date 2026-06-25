// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { useInputDraftHistory } from "../../ui/composables/useInputDraftHistory.js";
import { useInputStore } from "../../ui/stores/input.js";

function setup({ history = [], snippets = [], focused = true } = {}) {
  setActivePinia(createPinia());
  const store = useInputStore();
  store.inputHistory = [...history];
  store.snippetsCache = snippets.map((c) => ({ command: c }));

  const draft = ref("");
  const inputFocused = ref(focused);
  const sent = [];
  const { historyPrev, historyNext, cycleSnippet } = useInputDraftHistory(
    draft,
    inputFocused,
    (text) => sent.push(text),
  );
  return { draft, inputFocused, sent, historyPrev, historyNext, cycleSnippet };
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

  it("snippet 境界を越えると元の途中入力が復元される", () => {
    const { draft, cycleSnippet } = setup({ snippets: ["snippet1", "snippet2"] });
    draft.value = "partial";
    cycleSnippet(1);  // → snippet1
    expect(draft.value).toBe("snippet1");
    cycleSnippet(1);  // → snippet2
    expect(draft.value).toBe("snippet2");
    cycleSnippet(1);  // 境界を越える → 元の入力へ
    expect(draft.value).toBe("partial");
  });

  it("snippet を逆方向に辿って境界を越えると元の途中入力が復元される", () => {
    const { draft, cycleSnippet } = setup({ snippets: ["s1", "s2", "s3"] });
    draft.value = "abc";
    cycleSnippet(-1); // → s3 (last)
    expect(draft.value).toBe("s3");
    cycleSnippet(-1); // → s2
    expect(draft.value).toBe("s2");
    cycleSnippet(-1); // → s1
    expect(draft.value).toBe("s1");
    cycleSnippet(-1); // 境界 (next=-1) → 元の入力へ
    expect(draft.value).toBe("abc");
  });

  it("history 中に snippet ナビを始めて境界を越えると snippet 開始前（history 項目）に戻る", () => {
    const { draft, historyPrev, historyNext, cycleSnippet } = setup({
      history: ["git log"],
      snippets: ["echo hi"],
    });
    draft.value = "original";
    historyPrev();         // history[0]
    expect(draft.value).toBe("git log");
    cycleSnippet(1);       // snippet[0]（history 中に snippet へ切替）
    expect(draft.value).toBe("echo hi");
    cycleSnippet(1);       // 境界を越える → snippet 開始前（history 項目）へ
    expect(draft.value).toBe("git log");
    historyNext();         // history を抜ける → 元の途中入力へ
    expect(draft.value).toBe("original");
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
