// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { applyDispatchQueue, useDispatchConfirm } from "../../ui/composables/useDispatchConfirm.js";
import { on } from "../../ui/app-bridge.js";

const item = (id) => ({ id, request: { workspace: "ws1" } });
const recentItem = (id, decision) => ({ id, request: { workspace: "ws1" }, decision });

describe("applyDispatchQueue", () => {
  let queue, recent;

  beforeEach(() => {
    setActivePinia(createPinia());
    ({ queue, recent } = useDispatchConfirm());
    applyDispatchQueue([]);
  });

  it("スナップショット全量でキューを置き換える", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    expect(queue.value.map((q) => q.id)).toEqual(["d1", "d2"]);

    applyDispatchQueue([item("d3")]);
    expect(queue.value.map((q) => q.id)).toEqual(["d3"]);
  });

  it("空スナップショットで残存項目をすべて消す", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([]);
    expect(queue.value).toEqual([]);
  });

  it("消えた項目のIDだけ dispatch:itemRemoved で通知する（他端末で決定済み）", () => {
    const removedIds = [];
    const off = on("dispatch:itemRemoved", ({ id }) => removedIds.push(id));

    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([item("d1")]); // d2 だけ消える
    expect(removedIds).toEqual(["d2"]);

    off();
  });

  it("残っている項目は通知しない", () => {
    const removedIds = [];
    const off = on("dispatch:itemRemoved", ({ id }) => removedIds.push(id));

    applyDispatchQueue([item("d1"), item("d2")]);
    applyDispatchQueue([item("d1"), item("d2")]);
    expect(removedIds).toEqual([]);

    off();
  });

  it("recentItems をそのまま recent に反映する", () => {
    applyDispatchQueue([], [recentItem("r1", "approved"), recentItem("r2", "rejected")]);
    expect(recent.value.map((r) => [r.id, r.decision])).toEqual([
      ["r1", "approved"],
      ["r2", "rejected"],
    ]);
  });

  it("recentItems省略時は recent を空にする", () => {
    applyDispatchQueue([], [recentItem("r1", "approved")]);
    applyDispatchQueue([]);
    expect(recent.value).toEqual([]);
  });
});
