// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.js";

describe("layout store: splitWithDrop", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("未スプリット状態から left ドロップで horizontal split になる", () => {
    store.splitWithDrop("A", "left", []);
    expect(store.isSplitMode).toBe(true);
    expect(store.splitLayout).toBe("horizontal");
    expect(store.splitPaneTabIds[0]).toBe("A");
  });

  it("未スプリット状態から top ドロップで vertical split になる", () => {
    store.splitWithDrop("A", "top", []);
    expect(store.isSplitMode).toBe(true);
    expect(store.splitLayout).toBe("vertical");
    expect(store.splitPaneTabIds[0]).toBe("A");
  });

  it("vertical split 中に先頭ペインを left へドロップすると horizontal split へ遷移する", () => {
    // vertical: [A(top), B(bottom)]
    store.splitWithDrop("A", "top", []);
    store.splitPaneTabIds = ["A", "B"];
    expect(store.splitLayout).toBe("vertical");

    store.splitWithDrop("A", "left", []);

    expect(store.splitLayout).toBe("horizontal");
    expect(store.splitPaneTabIds).toEqual(["A", "B"]);
  });

  it("vertical split 中に末尾ペインを right へドロップすると horizontal split へ遷移する", () => {
    // vertical: [A(top), B(bottom)]
    store.splitWithDrop("A", "top", []);
    store.splitPaneTabIds = ["A", "B"];

    store.splitWithDrop("B", "right", []);

    expect(store.splitLayout).toBe("horizontal");
    expect(store.splitPaneTabIds).toEqual(["A", "B"]);
  });

  it("並び順・軸ともに変化がない場合は何もしない", () => {
    store.splitWithDrop("A", "left", []);
    // horizontal: [A(left), B(right)]
    store.splitPaneTabIds = ["A", "B"];

    store.splitWithDrop("A", "left", []);

    expect(store.splitLayout).toBe("horizontal");
    expect(store.splitPaneTabIds).toEqual(["A", "B"]);
  });
});

describe("layout store: exitSplitMode", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("スプリット状態をリセットする（SplitEmptyPane の Stop split から呼ばれる）", () => {
    store.splitWithDrop("A", "left", []);
    store.splitPaneTabIds = ["A", "B"];
    expect(store.isSplitMode).toBe(true);

    store.exitSplitMode();

    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
    expect(store.activePaneIndex).toBe(0);
  });
});

describe("layout store: replaceTabWithEmpty（Remove from split ボタン）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("押したペインだけ空きペインに置き換わり、スプリットは維持される", () => {
    // realTabIds/countRealPanes は数値IDのみを実ペインとみなすため、実タブIDに合わせて数値を使う。
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, 2];

    store.replaceTabWithEmpty(2);

    expect(store.isSplitMode).toBe(true);
    expect(store.splitPaneTabIds[0]).toBe(1);
    expect(store.isEmptyPaneId(store.splitPaneTabIds[1])).toBe(true);
  });

  it("実ペインが0件になったらスプリットを解除する", () => {
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, "empty:1"];

    store.replaceTabWithEmpty(1);

    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
  });
});

describe("layout store: splitEmptyPane（空きペインの横/縦分割ボタン）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("指定ペインの直後に新しい空きペインを追加し、指定軸に切り替える", () => {
    store.splitWithDrop("A", "left", []);
    store.splitPaneTabIds = ["A", "B"];

    store.splitEmptyPane(1, "vertical");

    expect(store.splitPaneTabIds.length).toBe(3);
    expect(store.splitPaneTabIds[0]).toBe("A");
    expect(store.splitPaneTabIds[1]).toBe("B");
    expect(store.isEmptyPaneId(store.splitPaneTabIds[2])).toBe(true);
    expect(store.splitLayout).toBe("vertical");
    expect(store.activePaneIndex).toBe(2);
  });

  it("スプリット中でなければ何もしない", () => {
    store.splitEmptyPane(0, "horizontal");
    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
  });
});
