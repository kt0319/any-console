// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, defineComponent, h } from "vue";

vi.mock("../../ui/app-bridge.ts", () => ({
  emit: vi.fn(),
}));

import { emit as bridgeEmit } from "../../ui/app-bridge.ts";
import { useEmbeddedPanel } from "../../ui/composables/useEmbeddedPanel.ts";

function mountPanel({ embedded, modalTitle }) {
  let panel;
  const emitted = [];
  const Comp = defineComponent({
    emits: ["close"],
    setup(_, { emit }) {
      panel = useEmbeddedPanel({
        embedded,
        title: "Send History",
        emit: (event) => { emitted.push(event); emit(event); },
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Comp, {
    global: { provide: modalTitle !== undefined ? { modalTitle } : {} },
  });
  return { wrapper, panel, emitted };
}

describe("useEmbeddedPanel", () => {
  beforeEach(() => {
    vi.mocked(bridgeEmit).mockClear();
  });

  it("通常表示（embedded=false）はmodalTitleを設定し、閉じる時はmodal:close", () => {
    const modalTitle = ref("");
    const { panel, emitted } = mountPanel({ embedded: false, modalTitle });
    expect(modalTitle.value).toBe("Send History");
    panel.closePanel();
    expect(bridgeEmit).toHaveBeenCalledWith("modal:close");
    expect(emitted).toEqual([]);
  });

  it("埋め込み表示（embedded=true）はmodalTitleを触らず、閉じる時はclose emit", () => {
    const modalTitle = ref("");
    const { panel, emitted } = mountPanel({ embedded: true, modalTitle });
    expect(modalTitle.value).toBe("");
    panel.closePanel();
    expect(emitted).toEqual(["close"]);
    expect(bridgeEmit).not.toHaveBeenCalled();
  });

  it("modalTitleのprovideが無い場合（KeyboardBar直下等）でも例外を出さない", () => {
    const { panel } = mountPanel({ embedded: false, modalTitle: undefined });
    panel.closePanel();
    expect(bridgeEmit).toHaveBeenCalledWith("modal:close");
  });
});
