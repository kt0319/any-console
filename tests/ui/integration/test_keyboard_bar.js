// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: SendSnippet / SendHistory / useKeyboardBarState */
import { defineComponent, ref } from "vue";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { on } from "../../../ui/app-bridge.ts";
import SendSnippet from "../../../ui/components/SendSnippet.vue";
import SendHistory from "../../../ui/components/SendHistory.vue";
import { useInputStore } from "../../../ui/stores/input.ts";
import { useKeyboardBarState } from "../../../ui/composables/useKeyboardBarState.ts";

// ── SendSnippet / SendHistory: 設定画面からの挿入 ──────────────────────────

describe("SendSnippet: 設定画面からのタップ挿入", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("スニペット行をタップすると keyboard:setDraft / modal:close が発火する", async () => {
    const inputStore = useInputStore();
    inputStore.snippetsCache = [{ label: "ls", command: "ls -la" }];

    const setDraftHandler = vi.fn();
    const closeHandler = vi.fn();
    const offs = [
      on("keyboard:setDraft", setDraftHandler),
      on("modal:close", closeHandler),
    ];

    const wrapper = mount(SendSnippet, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".snippet-command").trigger("click");

    expect(setDraftHandler).toHaveBeenCalledWith({ command: "ls -la" });
    expect(closeHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
    offs.forEach((off) => off());
  });
});

describe("SendHistory: 設定画面からのタップ挿入・削除", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("履歴行をタップすると keyboard:setDraft / modal:close が発火する", async () => {
    const inputStore = useInputStore();
    inputStore.inputHistory = ["echo hi"];

    const setDraftHandler = vi.fn();
    const closeHandler = vi.fn();
    const offs = [
      on("keyboard:setDraft", setDraftHandler),
      on("modal:close", closeHandler),
    ];

    const wrapper = mount(SendHistory, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".history-command").trigger("click");

    expect(setDraftHandler).toHaveBeenCalledWith({ command: "echo hi" });
    expect(closeHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
    offs.forEach((off) => off());
  });

  it("削除ボタンで inputStore.removeInputHistory が呼ばれる", async () => {
    const inputStore = useInputStore();
    inputStore.inputHistory = ["echo hi"];

    const wrapper = mount(SendHistory, { global: { provide: { modalTitle: ref("") } } });
    await wrapper.find(".history-delete").trigger("click");

    expect(inputStore.inputHistory).toEqual([]);
    wrapper.unmount();
  });
});

// ── useKeyboardBarState: スニペット/履歴パネルの直接選択 ────────────────────

describe("useKeyboardBarState: openSnippetPanel/openHistoryPanel の直接選択", () => {
  function mountState() {
    let state;
    const wrapper = mount(defineComponent({
      setup() {
        state = useKeyboardBarState({ keyboardInput: ref(null), clearModifiers: () => {} });
        return () => null;
      },
    }));
    return { wrapper, state: () => state };
  }

  it("openSnippetPanel/openHistoryPanelでQWERTYパネル内オーバーレイの状態を直接切り替える（選択式・再選択しても閉じない）", () => {
    const { wrapper, state } = mountState();

    state().openSnippetPanel();
    expect(state().snippetPanelView.value).toBe("snippets");

    state().openHistoryPanel();
    expect(state().snippetPanelView.value).toBe("history");

    state().openHistoryPanel();
    expect(state().snippetPanelView.value).toBe("history");

    wrapper.unmount();
  });

  it("closeSnippetPanelでパネル状態が none にリセットされる", () => {
    const { wrapper, state } = mountState();
    state().openSnippetPanel();
    expect(state().snippetPanelView.value).toBe("snippets");

    state().closeSnippetPanel();
    expect(state().snippetPanelView.value).toBe("none");

    wrapper.unmount();
  });
});
