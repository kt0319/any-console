import { describe, it, expect } from "vitest";
import { trailingItemsSignature, findChangedTrailingItem } from "../../ui/utils/pill-peek.js";

describe("trailingItemsSignature", () => {
  it("key -> text のMapを作る", () => {
    const items = [{ key: "branch", text: "main" }];
    const sig = trailingItemsSignature(items);
    expect(sig.get("branch")).toBe("main");
  });

  it("空配列/未指定でも空のMapを返す", () => {
    expect(trailingItemsSignature([]).size).toBe(0);
    expect(trailingItemsSignature(undefined).size).toBe(0);
  });
});

describe("findChangedTrailingItem", () => {
  it("新規追加された項目を検出する", () => {
    const prev = trailingItemsSignature([]);
    const items = [{ key: "push", text: "1" }];
    expect(findChangedTrailingItem(items, prev)).toEqual(items[0]);
  });

  it("既存項目のテキストが変わったら検出する", () => {
    const prev = trailingItemsSignature([{ key: "push", text: "1" }]);
    const items = [{ key: "push", text: "2" }];
    expect(findChangedTrailingItem(items, prev)).toEqual(items[0]);
  });

  it("変化が無ければ null", () => {
    const items = [{ key: "push", text: "1" }];
    const prev = trailingItemsSignature(items);
    expect(findChangedTrailingItem(items, prev)).toBeNull();
  });

  it("複数変化していれば並び順で最初の項目を返す", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [
      { key: "branch", text: "feature/x" },
      { key: "push", text: "2" },
    ];
    expect(findChangedTrailingItem(items, prev)).toEqual(items[0]);
  });

  it("項目が消えた場合は残っている項目に変化が無ければ null", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [{ key: "branch", text: "main" }];
    expect(findChangedTrailingItem(items, prev)).toBeNull();
  });
});
