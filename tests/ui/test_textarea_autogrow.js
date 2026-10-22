import { describe, it, expect } from "vitest";
import { resolveAutoGrow } from "../../ui/utils/textarea-autogrow.ts";

const base = { rowHeight: 18, paddingPx: 12, borderPx: 2, maxRows: 6 };

describe("resolveAutoGrow", () => {
  it("1行分ではスクロール不要でそのままの高さにする", () => {
    expect(resolveAutoGrow({ ...base, scrollHeight: 30 })).toEqual({ heightPx: 32, scrollable: false });
  });

  it("最大行数ちょうどまでは伸びてスクロールしない", () => {
    const scrollHeight = 18 * 6 + 12;
    expect(resolveAutoGrow({ ...base, scrollHeight })).toEqual({ heightPx: scrollHeight + 2, scrollable: false });
  });

  it("最大行数を超えたら高さを頭打ちにして内部スクロールにする", () => {
    expect(resolveAutoGrow({ ...base, scrollHeight: 18 * 10 + 12 })).toEqual({ heightPx: 18 * 6 + 12 + 2, scrollable: true });
  });
});
