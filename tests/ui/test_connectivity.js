// @ts-check
import { describe, it, expect } from "vitest";
import {
  isTabWsAlive,
  anyTabWsAlive,
  staleAliveTabs,
  decideOffline,
} from "../../ui/utils/connectivity.js";

const STALE = 35000;
const openTab = (overrides = {}) => ({ ws: {}, _wsDisposed: false, _lastWriteAt: 1000, ...overrides });

// ── isTabWsAlive ──

describe("isTabWsAlive", () => {
  it("open かつ最近 activity があれば生存", () => {
    expect(isTabWsAlive(openTab({ _lastWriteAt: 1000 }), 2000, STALE)).toBe(true);
  });

  it("activity が stale 閾値を超えたら死んでいる（半開き）", () => {
    expect(isTabWsAlive(openTab({ _lastWriteAt: 1000 }), 1000 + STALE, STALE)).toBe(false);
  });

  it("ws が無ければ死んでいる", () => {
    expect(isTabWsAlive(openTab({ ws: null }), 1000, STALE)).toBe(false);
  });

  it("_wsDisposed なら死んでいる（意図的クローズ）", () => {
    expect(isTabWsAlive(openTab({ _wsDisposed: true }), 1000, STALE)).toBe(false);
  });

  it("_lastWriteAt 未設定は 0 扱いで stale", () => {
    expect(isTabWsAlive(openTab({ _lastWriteAt: undefined }), STALE + 1, STALE)).toBe(false);
  });

  it("null/undefined tab は死んでいる", () => {
    expect(isTabWsAlive(null, 1000, STALE)).toBe(false);
    expect(isTabWsAlive(undefined, 1000, STALE)).toBe(false);
  });
});

// ── anyTabWsAlive ──

describe("anyTabWsAlive", () => {
  it("1本でも生きていれば true", () => {
    const tabs = [openTab({ _wsDisposed: true }), openTab({ _lastWriteAt: 900 })];
    expect(anyTabWsAlive(tabs, 1000, STALE)).toBe(true);
  });

  it("全て死んでいれば false", () => {
    const tabs = [openTab({ ws: null }), openTab({ _lastWriteAt: 0 })];
    expect(anyTabWsAlive(tabs, STALE + 1, STALE)).toBe(false);
  });

  it("空/未定義配列は false", () => {
    expect(anyTabWsAlive([], 1000, STALE)).toBe(false);
    expect(anyTabWsAlive(undefined, 1000, STALE)).toBe(false);
  });
});

// ── staleAliveTabs ──

describe("staleAliveTabs", () => {
  it("open だが activity 途絶したタブだけ返す", () => {
    const now = 1000 + STALE;
    const fresh = openTab({ _lastWriteAt: now });
    const stale = openTab({ _lastWriteAt: 0 });
    const disposed = openTab({ _wsDisposed: true, _lastWriteAt: 0 });
    const closed = openTab({ ws: null, _lastWriteAt: 0 });
    const result = staleAliveTabs([fresh, stale, disposed, closed], now, STALE);
    expect(result).toEqual([stale]);
  });

  it("空/未定義配列は空配列", () => {
    expect(staleAliveTabs([], 1000, STALE)).toEqual([]);
    expect(staleAliveTabs(undefined, 1000, STALE)).toEqual([]);
  });
});

// ── decideOffline ──

describe("decideOffline", () => {
  it("navigator.onLine=false は即オフライン", () => {
    expect(decideOffline({ navigatorOnline: false, anyWsAlive: true, consecutiveFailures: 0, threshold: 3 })).toBe(true);
  });

  it("生きた WS があればオフラインにしない（負荷時の誤検知防止）", () => {
    expect(decideOffline({ navigatorOnline: true, anyWsAlive: true, consecutiveFailures: 99, threshold: 3 })).toBe(false);
  });

  it("WS 無し・失敗が閾値未満はオンライン扱い", () => {
    expect(decideOffline({ navigatorOnline: true, anyWsAlive: false, consecutiveFailures: 2, threshold: 3 })).toBe(false);
  });

  it("WS 無し・失敗が閾値到達でオフライン", () => {
    expect(decideOffline({ navigatorOnline: true, anyWsAlive: false, consecutiveFailures: 3, threshold: 3 })).toBe(true);
  });
});
