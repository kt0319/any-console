// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { useScrollFade } from "../../ui/composables/useScrollFade.ts";

function mountScrollFade() {
  /** @type {any} */
  let api;
  const Comp = defineComponent({
    setup() {
      const el = ref(null);
      api = useScrollFade(el);
      return () => h("div", { ref: el, style: api.fadeStyle.value, onScroll: api.updateScrollFade });
    },
  });
  const wrapper = mount(Comp, { attachTo: document.body });
  const node = /** @type {HTMLElement} */ (wrapper.element);
  const setMetrics = (scrollLeft, scrollWidth, clientWidth) => {
    Object.defineProperty(node, "scrollLeft", { value: scrollLeft, configurable: true });
    Object.defineProperty(node, "scrollWidth", { value: scrollWidth, configurable: true });
    Object.defineProperty(node, "clientWidth", { value: clientWidth, configurable: true });
  };
  return { wrapper, api, setMetrics };
}

describe("useScrollFade", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("はみ出していなければmaskを付けない", async () => {
    const { wrapper, api, setMetrics } = mountScrollFade();
    setMetrics(0, 300, 300);
    api.updateScrollFade();
    await nextTick();
    expect(api.fadeStyle.value.maskImage).toBe("none");
    wrapper.unmount();
  });

  it("右にはみ出していれば右端をフェードし、スクロールすると左端もフェードする", async () => {
    const { wrapper, api, setMetrics } = mountScrollFade();
    setMetrics(0, 600, 300);
    api.updateScrollFade();
    expect(api.fadeStyle.value.maskImage).toContain("transparent)");
    expect(api.fadeStyle.value.maskImage).not.toContain("transparent, black");
    setMetrics(100, 600, 300);
    api.updateScrollFade();
    expect(api.fadeStyle.value.maskImage).toContain("transparent, black");
    wrapper.unmount();
  });

  it("右端までスクロールしたら右のフェードを外す", async () => {
    const { wrapper, api, setMetrics } = mountScrollFade();
    setMetrics(300, 600, 300);
    api.updateScrollFade();
    expect(api.fadeStyle.value.maskImage).toContain("transparent, black");
    expect(api.fadeStyle.value.maskImage).not.toContain("transparent)");
    wrapper.unmount();
  });
});
