// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLayoutStore } from "../../ui/stores/layout.js";
import { useTerminalStore } from "../../ui/stores/terminal.js";

// addTerminalTab は xterm 依存で重いので使わず、id だけの最小タブを直接挿入する
// （test_terminal_store.js の seedTabs と同じ方針）。
function seedTabs(terminalStore, ids) {
  terminalStore.openTabs = ids.map((id) => ({ id, sessionId: "", term: null, ws: null }));
}

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

  it("スプリット状態をリセットする（SplitEmptyPane の SplitModeSelector Single pane から呼ばれる）", () => {
    store.splitWithDrop("A", "left", []);
    store.splitPaneTabIds = ["A", "B"];
    expect(store.isSplitMode).toBe(true);

    store.exitSplitMode();

    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
    expect(store.activePaneIndex).toBe(0);
  });

  it("targetTabId未指定でも、アクティブペインが実タブならそれをactiveTabIdにする", () => {
    // switchTab は openTabs にヒットすると localStorage に触れるため、
    // ここでは activeTabId の代入だけを見たいので openTabs は空のままにする。
    const terminalStore = useTerminalStore();
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, 2];
    store.activePaneIndex = 1;

    store.exitSplitMode();

    expect(terminalStore.activeTabId).toBe(2);
  });

  it("アクティブペインが空きペインでも、他に実タブがあればそれにフォールバックする", () => {
    const terminalStore = useTerminalStore();
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, "empty:1"];
    store.activePaneIndex = 1; // 空きペインをアクティブにした状態

    store.exitSplitMode();

    expect(terminalStore.activeTabId).toBe(1);
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

describe("layout store: addPane（空きペインの Add pane ボタン）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("指定ペインの直後に新しい空きペインを追加する（レイアウト軸は変更しない）", () => {
    seedTabs(useTerminalStore(), [1, 2, 3]); // ペイン数(2)より多いタブが必要
    store.splitWithDrop("A", "left", []);
    store.splitPaneTabIds = ["A", "B"];

    store.addPane(1);

    expect(store.splitPaneTabIds.length).toBe(3);
    expect(store.splitPaneTabIds[0]).toBe("A");
    expect(store.splitPaneTabIds[1]).toBe("B");
    expect(store.isEmptyPaneId(store.splitPaneTabIds[2])).toBe(true);
    expect(store.splitLayout).toBe("horizontal");
    expect(store.activePaneIndex).toBe(2);
  });

  it("開いているタブ数以上にはペインを増やさない", () => {
    seedTabs(useTerminalStore(), [1, 2]); // タブは2つしかない
    store.splitWithDrop("A", "left", []);
    store.splitPaneTabIds = ["A", "B"]; // 既にペインも2つ＝タブ数と同数

    store.addPane(1);

    expect(store.splitPaneTabIds).toEqual(["A", "B"]);
  });

  it("スプリット中でなければ何もしない", () => {
    store.addPane(0);
    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
  });
});

describe("layout store: removeEmptyPane（空きペインの × ボタン）", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLayoutStore();
  });

  it("3ペイン中の空きペインを削除すると、他のペインを保ったままスプリットは維持される", () => {
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, 2, "empty:1"];

    const target = store.removeEmptyPane(2);

    expect(target).toBeNull();
    expect(store.isSplitMode).toBe(true);
    expect(store.splitPaneTabIds).toEqual([1, 2]);
  });

  it("2ペイン中の空きペインを削除すると分割解除し、残った実タブへの切り替え先を返す", () => {
    store.splitWithDrop(1, "left", []);
    store.splitPaneTabIds = [1, "empty:1"];

    const target = store.removeEmptyPane(1);

    expect(target).toBe(1);
    expect(store.isSplitMode).toBe(false);
    expect(store.splitPaneTabIds).toEqual([]);
  });

  it("スプリット中でなければ何もしない", () => {
    const target = store.removeEmptyPane(0);
    expect(target).toBeNull();
    expect(store.isSplitMode).toBe(false);
  });
});
