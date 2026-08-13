import { describe, it, expect, vi } from "vitest";
import { usePaneLoader } from "../../ui/composables/usePaneLoader.ts";

describe("usePaneLoader", () => {
  it("同じキーでの2回目以降のensureはロードしない", () => {
    const { ensure } = usePaneLoader();
    const loader = vi.fn();
    ensure("history", "ws1", loader);
    ensure("history", "ws1", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("キーが変わったらロードし直す", () => {
    const { ensure } = usePaneLoader();
    const loader = vi.fn();
    ensure("history", "ws1", loader);
    ensure("history", "ws2", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("ペインごとに独立して管理される", () => {
    const { ensure } = usePaneLoader();
    const historyLoader = vi.fn();
    const filesLoader = vi.fn();
    ensure("history", "ws1", historyLoader);
    ensure("files", "ws1", filesLoader);
    expect(historyLoader).toHaveBeenCalledTimes(1);
    expect(filesLoader).toHaveBeenCalledTimes(1);
  });

  it("invalidate後は同じキーでも再ロードする", () => {
    const { ensure, invalidate } = usePaneLoader();
    const loader = vi.fn();
    ensure("history", "ws1", loader);
    invalidate("history");
    ensure("history", "ws1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("markLoadedで別経路のロードをロード済み扱いにできる", () => {
    const { ensure, markLoaded } = usePaneLoader();
    const loader = vi.fn();
    markLoaded("files", "ws1");
    ensure("files", "ws1", loader);
    expect(loader).not.toHaveBeenCalled();
    // 別キーなら再ロードする
    ensure("files", "ws2", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("キーはnull/undefinedも区別して扱う", () => {
    const { ensure } = usePaneLoader();
    const loader = vi.fn();
    ensure("view", null, loader);
    ensure("view", null, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    ensure("view", "ws1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
