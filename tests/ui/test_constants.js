// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copy of extractApiError from constants.js ──

const MSG_ERROR_OCCURRED = "エラーが発生しました";

function extractApiError(data, fallback = MSG_ERROR_OCCURRED) {
  return data?.detail || data?.message || fallback;
}

// ── Tests ──

describe("extractApiError", () => {
  it("detailを優先的に返す", () => {
    assert.equal(extractApiError({ detail: "not found", message: "msg" }), "not found");
  });

  it("detailがなければmessageを返す", () => {
    assert.equal(extractApiError({ message: "something wrong" }), "something wrong");
  });

  it("detail/messageどちらもなければデフォルトfallbackを返す", () => {
    assert.equal(extractApiError({}), MSG_ERROR_OCCURRED);
  });

  it("カスタムfallbackを返す", () => {
    assert.equal(extractApiError({}, "カスタムエラー"), "カスタムエラー");
  });

  it("nullに対してfallbackを返す", () => {
    assert.equal(extractApiError(null), MSG_ERROR_OCCURRED);
  });

  it("undefinedに対してfallbackを返す", () => {
    assert.equal(extractApiError(undefined), MSG_ERROR_OCCURRED);
  });

  it("detailが空文字の場合messageにフォールバック", () => {
    assert.equal(extractApiError({ detail: "", message: "msg" }), "msg");
  });

  it("detail/messageどちらも空文字の場合fallback", () => {
    assert.equal(extractApiError({ detail: "", message: "" }), MSG_ERROR_OCCURRED);
  });
});
