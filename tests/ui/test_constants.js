// @ts-check
import { describe, it, expect } from "vitest";
import { extractApiError, MSG_ERROR_OCCURRED } from "../../ui/utils/constants.js";

// ── Tests ──

describe("extractApiError", () => {
  it("detailを優先的に返す", () => {
    expect(extractApiError({ detail: "not found", message: "msg" })).toBe("not found");
  });

  it("detailがなければmessageを返す", () => {
    expect(extractApiError({ message: "something wrong" })).toBe("something wrong");
  });

  it("detail/messageどちらもなければデフォルトfallbackを返す", () => {
    expect(extractApiError({})).toBe(MSG_ERROR_OCCURRED);
  });

  it("カスタムfallbackを返す", () => {
    expect(extractApiError({}, "カスタムエラー")).toBe("カスタムエラー");
  });

  it("nullに対してfallbackを返す", () => {
    expect(extractApiError(null)).toBe(MSG_ERROR_OCCURRED);
  });

  it("undefinedに対してfallbackを返す", () => {
    expect(extractApiError(undefined)).toBe(MSG_ERROR_OCCURRED);
  });

  it("detailが空文字の場合messageにフォールバック", () => {
    expect(extractApiError({ detail: "", message: "msg" })).toBe("msg");
  });

  it("detail/messageどちらも空文字の場合fallback", () => {
    expect(extractApiError({ detail: "", message: "" })).toBe(MSG_ERROR_OCCURRED);
  });
});
