// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSaveScheduler } from "../../ui/utils/save-scheduler.ts";

describe("createSaveScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delayMs経過後に保存関数を1回呼ぶ", () => {
    const saver = createSaveScheduler(100);
    const fn = vi.fn();
    saver.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("連続scheduleは後勝ちでdebounceされる", () => {
    const saver = createSaveScheduler(100);
    const first = vi.fn();
    const second = vi.fn();
    saver.schedule(first);
    vi.advanceTimersByTime(50);
    saver.schedule(second);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancelで予約中の保存を取り消す", () => {
    const saver = createSaveScheduler(100);
    const fn = vi.fn();
    saver.schedule(fn);
    saver.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("発火後のcancelは安全に呼べる", () => {
    const saver = createSaveScheduler(100);
    saver.schedule(() => {});
    vi.advanceTimersByTime(100);
    expect(() => saver.cancel()).not.toThrow();
  });
});
