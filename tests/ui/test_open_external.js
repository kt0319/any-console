// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openExternal, toSafariUrl, isIosStandalonePwa, onExternalLinkClick } from "../../ui/utils/open-external.ts";
import { SAFARI_HANDOFF_FALLBACK_MS } from "../../ui/utils/constants.ts";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

function setNavigator({ ua = "Mozilla/5.0", standalone }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  Object.defineProperty(navigator, "standalone", { value: standalone, configurable: true });
}

describe("open-external", () => {
  beforeEach(() => {
    window.happyDOM.setURL("http://localhost:8888/");
    vi.useFakeTimers();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete navigator.standalone;
  });

  it("toSafariUrl は別オリジンの http(s) のみ変換しクエリとフラグメントを保持する", () => {
    expect(toSafariUrl("https://github.com/a/b?x=1&y=2#frag")).toBe("x-safari-https://github.com/a/b?x=1&y=2#frag");
    expect(toSafariUrl("http://example.com/")).toBe("x-safari-http://example.com/");
    expect(toSafariUrl("vscode://file/x")).toBeNull();
    expect(toSafariUrl("mailto:a@b.c")).toBeNull();
    expect(toSafariUrl("/relative/path")).toBeNull();
    expect(toSafariUrl(`${window.location.origin}/x`)).toBeNull();
  });

  it("通常ブラウザでは window.open のまま", () => {
    setNavigator({ ua: IPHONE_UA, standalone: false });
    expect(isIosStandalonePwa()).toBe(false);
    openExternal("https://example.com/");
    expect(window.open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
  });

  it("Android や PC の standalone は対象外", () => {
    setNavigator({ ua: "Mozilla/5.0 (Linux; Android 14)", standalone: true });
    expect(isIosStandalonePwa()).toBe(false);
  });

  it("iOS スタンドアロンでは x-safari-https へ遷移し、起動しなければ通常URLで開く", () => {
    setNavigator({ ua: IPHONE_UA, standalone: true });
    const assigned = [];
    Object.defineProperty(window.location, "href", { configurable: true, get: () => "http://localhost:8888/", set: (v) => assigned.push(v) });
    openExternal("https://example.com/p?q=1#h");
    expect(assigned).toEqual(["x-safari-https://example.com/p?q=1#h"]);
    expect(window.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAFARI_HANDOFF_FALLBACK_MS);
    expect(window.open).toHaveBeenCalledWith("https://example.com/p?q=1#h", "_blank", "noopener,noreferrer");
  });

  it("onExternalLinkClick は通常環境では既定動作を妨げない", () => {
    setNavigator({ ua: IPHONE_UA, standalone: false });
    const a = document.createElement("a");
    a.href = "https://example.com/";
    const e = { currentTarget: a, preventDefault: vi.fn() };
    onExternalLinkClick(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("iOS PWA では別オリジンのリンクのみ横取りし、内部リンクは触らない", () => {
    setNavigator({ ua: IPHONE_UA, standalone: true });
    const ext = document.createElement("a");
    ext.href = "https://example.com/";
    const internal = document.createElement("a");
    internal.href = `${window.location.origin}/x`;
    const e1 = { currentTarget: ext, preventDefault: vi.fn() };
    const e2 = { currentTarget: internal, preventDefault: vi.fn() };
    onExternalLinkClick(e1);
    onExternalLinkClick(e2);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });
});
