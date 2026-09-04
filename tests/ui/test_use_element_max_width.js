// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useElementMaxWidth } from "../../ui/composables/useElementMaxWidth.ts";

// ResizeObserverをテスト側から手動で発火できるようにモックする
// （happy-domは実レイアウト計算を行わないため、contentRect.widthを直接注入する）。
let roCallback;
class FakeResizeObserver {
  constructor(cb) { roCallback = cb; }
  observe() {}
  disconnect() {}
}

function mountWithMaxWidth(reservedPx) {
  const el = ref(null);
  const wrapper = mount(defineComponent({
    setup() {
      const { maxWidth } = useElementMaxWidth(el, reservedPx);
      return { maxWidth };
    },
    render() { return h("div", { ref: (r) => { el.value = r; } }); },
  }), { attachTo: document.body });
  return { wrapper, el };
}

describe("useElementMaxWidth", () => {
  const originalRO = global.ResizeObserver;
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    global.ResizeObserver = originalRO;
    window.innerWidth = originalInnerWidth;
    vi.restoreAllMocks();
  });

  it("実測幅からreservedPxを引いた値を返す（画面幅の半分未満の場合）", async () => {
    global.ResizeObserver = FakeResizeObserver;
    window.innerWidth = 2000;
    const { wrapper } = mountWithMaxWidth(40);
    roCallback([{ contentRect: { width: 300 } }]);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.maxWidth).toBe(260);
    wrapper.unmount();
  });

  it("画面幅の半分を上限にする", async () => {
    global.ResizeObserver = FakeResizeObserver;
    window.innerWidth = 400;
    const { wrapper } = mountWithMaxWidth(40);
    roCallback([{ contentRect: { width: 1000 } }]);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.maxWidth).toBe(200);
    wrapper.unmount();
  });

  it("reservedPxが実測幅を超える場合は0未満にならない", async () => {
    global.ResizeObserver = FakeResizeObserver;
    window.innerWidth = 2000;
    const { wrapper } = mountWithMaxWidth(500);
    roCallback([{ contentRect: { width: 100 } }]);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.maxWidth).toBe(0);
    wrapper.unmount();
  });
});
