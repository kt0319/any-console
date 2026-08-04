// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalPaneGestures } from "../../ui/composables/useTerminalPaneGestures.js";
import { useLayoutStore } from "../../ui/stores/layout.js";

function makeTouchStart(x, y) {
  return { touches: [{ clientX: x, clientY: y }], target: document.createElement("div") };
}

function makeTouchMove(x, y) {
  return { touches: [{ clientX: x, clientY: y }], target: document.createElement("div") };
}

function makeGestures({ isActive }) {
  const circleKeypad = { enabled: true, state: { visible: false }, open: vi.fn(), update: vi.fn() };
  const gestures = useTerminalPaneGestures({
    tab: ref({ id: 1, term: null }),
    pillEl: ref(null),
    circleKeypad,
    isActive: ref(isActive),
    paneIndex: ref(0),
    onSelectPane: vi.fn(),
  });
  return { gestures, circleKeypad };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useTerminalPaneGestures: 分割中の非アクティブペインでのサークルキーパッド", () => {
  it("非アクティブペインでのスワイプではサークルキーパッドを開かない", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = true;
    const { gestures, circleKeypad } = makeGestures({ isActive: false });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150)); // 50px上下移動 > CIRCLE_KEYPAD_TRIGGER_PX(36)

    expect(circleKeypad.open).not.toHaveBeenCalled();
  });

  it("アクティブペインでのスワイプはサークルキーパッドを開く", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = true;
    const { gestures, circleKeypad } = makeGestures({ isActive: true });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150));

    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });

  it("分割中でなければisActiveに関わらずサークルキーパッドを開く", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = false;
    const { gestures, circleKeypad } = makeGestures({ isActive: false });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150));

    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });
});
