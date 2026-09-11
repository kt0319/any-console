// @vitest-environment happy-dom
/**
 * Select & Copy ペイン（TerminalSelectPane.vue）の Copy / Copy with Trim ボタンの
 * 回帰テスト。選択なしでの誤コピー防止（トースト案内）と、選択範囲をそのまま/
 * 改行・スペース除去してコピーする経路を確認する（純粋なtrim関数自体は
 * test_auto_format.js側でカバーする）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TerminalSelectPane from "../../../ui/components/TerminalSelectPane.vue";

const copyTextMock = vi.fn(async () => true);
vi.mock("../../../ui/utils/clipboard.ts", () => ({
  copyText: (text) => copyTextMock(text),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("../../../ui/composables/useToast.ts", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  copyTextMock.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

function selectText(textarea, start, end) {
  textarea.setSelectionRange(start, end);
}

describe("TerminalSelectPane: Copy / Copy with Trim", () => {
  it("未選択でCopyを押すと案内トーストを出しコピーしない", async () => {
    const wrapper = mount(TerminalSelectPane, { attachTo: document.body });
    await wrapper.find("button.primary").trigger("click");
    await flushPromises();

    expect(copyTextMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Select text first");
    wrapper.unmount();
  });

  it("選択範囲をそのままコピーする", async () => {
    const wrapper = mount(TerminalSelectPane, { attachTo: document.body });
    const textarea = wrapper.find("textarea").element;
    textarea.value = "https://example.com/path\n  more";
    selectText(textarea, 0, textarea.value.length);

    await wrapper.find("button.primary").trigger("click");
    await flushPromises();

    expect(copyTextMock).toHaveBeenCalledWith("https://example.com/path\n  more");
    expect(toastSuccess).toHaveBeenCalledWith("Copied");
    wrapper.unmount();
  });

  it("Copy with Trimは選択範囲から改行とスペースを除去してコピーする", async () => {
    const wrapper = mount(TerminalSelectPane, { attachTo: document.body });
    const textarea = wrapper.find("textarea").element;
    textarea.value = "https://example.com/path\n  more";
    selectText(textarea, 0, textarea.value.length);

    const buttons = wrapper.findAll("button.copy-full-btn");
    const trimButton = buttons.find((b) => b.text().includes("Copy with Trim"));
    await trimButton.trigger("click");
    await flushPromises();

    expect(copyTextMock).toHaveBeenCalledWith("https://example.com/pathmore");
    wrapper.unmount();
  });

  it("未選択でCopy with Trimを押しても案内トーストを出しコピーしない", async () => {
    const wrapper = mount(TerminalSelectPane, { attachTo: document.body });
    const buttons = wrapper.findAll("button.copy-full-btn");
    const trimButton = buttons.find((b) => b.text().includes("Copy with Trim"));
    await trimButton.trigger("click");
    await flushPromises();

    expect(copyTextMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Select text first");
    wrapper.unmount();
  });
});
