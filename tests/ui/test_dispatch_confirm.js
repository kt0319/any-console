// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { applyDispatchQueue, useDispatchConfirm } from "../../ui/composables/useDispatchConfirm.js";
import { useDispatchPrompt } from "../../ui/composables/useDispatchPrompt.js";

const item = (id) => ({ id, request: { workspace: "ws1" } });

describe("applyDispatchQueue", () => {
  let queue;
  let prompt;

  beforeEach(() => {
    setActivePinia(createPinia());
    ({ queue } = useDispatchConfirm());
    prompt = useDispatchPrompt();
    // queue と prompt はモジュールシングルトンのため、前のテストの状態をリセットする
    if (prompt.visible.value) prompt.cancel();
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

  it("表示中ダイアログの対象が消えたら閉じる（他端末で決定済み）", async () => {
    applyDispatchQueue([item("d1")]);
    const resultPromise = prompt.open(item("d1").request, "d1");
    expect(prompt.visible.value).toBe(true);

    applyDispatchQueue([]);
    expect(prompt.visible.value).toBe(false);
    await expect(resultPromise).resolves.toEqual({ approved: false, overrides: {} });
  });

  it("対象が残っている間はダイアログを閉じない", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    prompt.open(item("d1").request, "d1");

    applyDispatchQueue([item("d1")]); // d2 だけ消える
    expect(prompt.visible.value).toBe(true);
    prompt.cancel();
  });

  it("別IDのダイアログ表示中に無関係な項目が消えても閉じない", () => {
    applyDispatchQueue([item("d1"), item("d2")]);
    prompt.open(item("d2").request, "d2");

    applyDispatchQueue([item("d2")]); // d1 が消えるが表示中は d2
    expect(prompt.visible.value).toBe(true);
    prompt.cancel();
  });
});
