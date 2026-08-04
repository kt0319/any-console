import { describe, it, expect } from "vitest";
import { trailingItemsSignature, findChangedTrailingItems } from "../../ui/utils/pill-peek.js";

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

describe("findChangedTrailingItems", () => {
  it("新規追加された項目を検出する", () => {
    const prev = trailingItemsSignature([]);
    const items = [{ key: "push", text: "1" }];
    expect(findChangedTrailingItems(items, prev)).toEqual([items[0]]);
  });

  it("既存項目のテキストが変わったら検出する", () => {
    const prev = trailingItemsSignature([{ key: "push", text: "1" }]);
    const items = [{ key: "push", text: "2" }];
    expect(findChangedTrailingItems(items, prev)).toEqual([items[0]]);
  });

  it("変化が無ければ空配列", () => {
    const items = [{ key: "push", text: "1" }];
    const prev = trailingItemsSignature(items);
    expect(findChangedTrailingItems(items, prev)).toEqual([]);
  });

  it("複数変化していれば items の並び順で全て返す", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [
      { key: "branch", text: "feature/x" },
      { key: "push", text: "2" },
    ];
    expect(findChangedTrailingItems(items, prev)).toEqual(items);
  });

  it("項目が消えた場合は残っている項目に変化が無ければ空配列", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [{ key: "branch", text: "main" }];
    expect(findChangedTrailingItems(items, prev)).toEqual([]);
  });
});
