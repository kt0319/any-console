// @ts-check
import { describe, it, expect, vi } from "vitest";
import { createArrowFlickHandler } from "../../ui/utils/arrow-flick.ts";

function makeHandler(focused = true) {
  const deps = {
    isInputFocused: () => focused,
    historyPrev: vi.fn(),
    historyNext: vi.fn(),
    snippetPrev: vi.fn(),
    snippetNext: vi.fn(),
  };
  return { handler: createArrowFlickHandler(deps), deps };
}

describe("createArrowFlickHandler", () => {
  it("ignores flicks when input is not focused", () => {
    const { handler, deps } = makeHandler(false);
    expect(handler.onFlick({ key: "ArrowUp" })).toBe(false);
    expect(deps.historyPrev).not.toHaveBeenCalled();
  });

  it("ignores ArrowLeft/ArrowRight when not focused (falls back to default key send)", () => {
    const { handler, deps } = makeHandler(false);
    expect(handler.onFlick({ key: "ArrowLeft" })).toBe(false);
    expect(handler.onFlick({ key: "ArrowRight" })).toBe(false);
    expect(deps.snippetPrev).not.toHaveBeenCalled();
    expect(deps.snippetNext).not.toHaveBeenCalled();
  });

  it("navigates snippets prev/next on ArrowLeft/ArrowRight when focused", () => {
    const { handler, deps } = makeHandler();
    handler.onFlick({ key: "ArrowLeft" });
    expect(deps.snippetPrev).toHaveBeenCalledTimes(1);
    handler.reset();
    handler.onFlick({ key: "ArrowRight" });
    expect(deps.snippetNext).toHaveBeenCalledTimes(1);
  });

  it("navigates history up/down on ArrowUp/ArrowDown", () => {
    const { handler, deps } = makeHandler();
    handler.onFlick({ key: "ArrowUp" });
    expect(deps.historyPrev).toHaveBeenCalledTimes(1);
    handler.reset();
    handler.onFlick({ key: "ArrowDown" });
    expect(deps.historyNext).toHaveBeenCalledTimes(1);
  });

  it("latches up/down so a single gesture acts once until reset", () => {
    const { handler, deps } = makeHandler();
    expect(handler.onFlick({ key: "ArrowUp" })).toBe(true);
    // 同一ジェスチャ内の追加フリックは消費するが履歴移動はしない
    expect(handler.onFlick({ key: "ArrowDown" })).toBe(true);
    expect(deps.historyPrev).toHaveBeenCalledTimes(1);
    expect(deps.historyNext).not.toHaveBeenCalled();
    // reset 後は再び反応する
    handler.reset();
    handler.onFlick({ key: "ArrowDown" });
    expect(deps.historyNext).toHaveBeenCalledTimes(1);
  });
});
