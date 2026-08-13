// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalPaneGestures } from "../../ui/composables/useTerminalPaneGestures.ts";
import { useLayoutStore } from "../../ui/stores/layout.ts";

function makeTouchStart(x, y) {
  return { touches: [{ clientX: x, clientY: y }], target: document.createElement("div") };
}

function makeTouchMove(x, y) {
  return { touches: [{ clientX: x, clientY: y }], target: document.createElement("div") };
}

function makeGestures({ isActive }) {
  const circleKeypad = { enabled: true, state: { visible: false }, open: vi.fn(), update: vi.fn() };
  const onSelectPane = vi.fn();
  const gestures = useTerminalPaneGestures({
    tab: ref({ id: 1, term: null }),
    pillEl: ref(null),
    circleKeypad,
    isActive: ref(isActive),
    paneIndex: ref(2),
    onSelectPane,
  });
  return { gestures, circleKeypad, onSelectPane };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useTerminalPaneGestures: 分割中の非アクティブペインでのサークルキーパッド", () => {
  it("非アクティブペインでのスワイプはそのペインをアクティブにしてからサークルキーパッドを開く", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = true;
    const { gestures, circleKeypad, onSelectPane } = makeGestures({ isActive: false });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150)); // 50px上下移動 > CIRCLE_KEYPAD_TRIGGER_PX(36)

    expect(onSelectPane).toHaveBeenCalledWith(2);
    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });

  it("アクティブペインでのスワイプはペイン切替えを呼ばずサークルキーパッドを開く", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = true;
    const { gestures, circleKeypad, onSelectPane } = makeGestures({ isActive: true });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150));

    expect(onSelectPane).not.toHaveBeenCalled();
    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });

  it("分割中でなければペイン切替えは呼ばずサークルキーパッドを開く", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = false;
    const { gestures, circleKeypad, onSelectPane } = makeGestures({ isActive: false });

    gestures.onTouchStart(makeTouchStart(100, 100));
    gestures.onTouchMove(makeTouchMove(100, 150));

    expect(onSelectPane).not.toHaveBeenCalled();
    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });
});

describe("useTerminalPaneGestures: 右クリックドラッグでのサークルキーパッド", () => {
  function fireDocument(type, init) {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  }

  it("右クリック以外のボタンではドラッグを開始しない", () => {
    const { gestures, circleKeypad } = makeGestures({ isActive: true });
    gestures.onMouseDown({ button: 0, target: document.createElement("div") });
    fireDocument("mousemove", { clientX: 150, clientY: 150 });
    expect(circleKeypad.open).not.toHaveBeenCalled();
  });

  it("右クリック+ドラッグでサークルキーパッドを開き、mouseupでcommitAndCloseする", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = false;
    const circleKeypad = { enabled: true, state: { visible: false }, open: vi.fn(), update: vi.fn(), commitAndClose: vi.fn() };
    const tab = ref({ id: 1, term: null });
    const gestures = useTerminalPaneGestures({
      tab, pillEl: ref(null), circleKeypad, isActive: ref(true), paneIndex: ref(0), onSelectPane: vi.fn(),
    });

    gestures.onMouseDown({ button: 2, clientX: 100, clientY: 100, target: document.createElement("div") });
    circleKeypad.state.visible = false;
    fireDocument("mousemove", { clientX: 100, clientY: 150 }); // 50px > CIRCLE_KEYPAD_TRIGGER_PX(36)
    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);

    circleKeypad.state.visible = true;
    fireDocument("mousemove", { clientX: 100, clientY: 160 });
    expect(circleKeypad.update).toHaveBeenCalledWith(100, 160);

    fireDocument("mouseup", {});
    expect(circleKeypad.commitAndClose).toHaveBeenCalledWith(tab.value);
  });

  it("分割中の非アクティブペインでは右クリックドラッグでもそのペインをアクティブにする", () => {
    const layoutStore = useLayoutStore();
    layoutStore.isSplitMode = true;
    const { gestures, circleKeypad, onSelectPane } = makeGestures({ isActive: false });

    gestures.onMouseDown({ button: 2, clientX: 100, clientY: 100, target: document.createElement("div") });
    fireDocument("mousemove", { clientX: 100, clientY: 150 });

    expect(onSelectPane).toHaveBeenCalledWith(2);
    expect(circleKeypad.open).toHaveBeenCalledWith(100, 100);
  });

  it("onContextMenuはデフォルトのコンテキストメニューを抑止する", () => {
    const { gestures } = makeGestures({ isActive: true });
    const preventDefault = vi.fn();
    gestures.onContextMenu({ target: document.createElement("div"), preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });
});
