import { describe, it, expect } from "vitest";
import {
  asyncIdle,
  asyncLoading,
  asyncReady,
  asyncError,
  isAsyncPending,
  asyncValueOr,
} from "../../ui/utils/async-state.ts";

describe("async-state", () => {
  it("asyncIdle/asyncLoading/asyncReady/asyncErrorがstatusを正しく持つ値を作る", () => {
    expect(asyncIdle()).toEqual({ status: "idle" });
    expect(asyncLoading()).toEqual({ status: "loading" });
    expect(asyncReady([1, 2, 3])).toEqual({ status: "ready", value: [1, 2, 3] });
    expect(asyncError("boom")).toEqual({ status: "error", error: "boom" });
  });

  it("isAsyncPendingはidle/loadingでtrue、ready/errorでfalse", () => {
    expect(isAsyncPending(asyncIdle())).toBe(true);
    expect(isAsyncPending(asyncLoading())).toBe(true);
    expect(isAsyncPending(asyncReady([]))).toBe(false);
    expect(isAsyncPending(asyncError("boom"))).toBe(false);
  });

  it("asyncValueOrはreadyの時だけvalueを返し、それ以外はfallback", () => {
    expect(asyncValueOr(asyncReady([1, 2]), [])).toEqual([1, 2]);
    expect(asyncValueOr(asyncIdle(), ["fallback"])).toEqual(["fallback"]);
    expect(asyncValueOr(asyncLoading(), ["fallback"])).toEqual(["fallback"]);
    expect(asyncValueOr(asyncError("boom"), ["fallback"])).toEqual(["fallback"]);
  });
});
