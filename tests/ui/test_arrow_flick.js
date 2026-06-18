// @ts-check
import { describe, it, expect, vi } from "vitest";
import { createArrowFlickHandler } from "../../ui/utils/arrow-flick.js";

function makeHandler(focused = true) {
  const deps = {
    isInputFocused: () => focused,
    cycleSnippet: vi.fn(),
    historyPrev: vi.fn(),
    historyNext: vi.fn(),
  };
  return { handler: createArrowFlickHandler(deps), deps };
}

describe("createArrowFlickHandler", () => {
  it("ignores flicks when input is not focused", () => {
    const { handler, deps } = makeHandler(false);
    expect(handler.onFlick({ key: "ArrowLeft" })).toBe(false);
    expect(deps.cycleSnippet).not.toHaveBeenCalled();
  });

  it("cycles snippet forward on ArrowLeft and back on ArrowRight", () => {
    const { handler, deps } = makeHandler();
    expect(handler.onFlick({ key: "ArrowLeft" })).toBe(true);
    expect(deps.cycleSnippet).toHaveBeenCalledWith(1);
    handler.reset();
    handler.onFlick({ key: "ArrowRight" });
    expect(deps.cycleSnippet).toHaveBeenCalledWith(-1);
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

  it("latches left/right snippet cycling within one gesture", () => {
    const { handler, deps } = makeHandler();
    handler.onFlick({ key: "ArrowLeft" });
    handler.onFlick({ key: "ArrowLeft" });
    expect(deps.cycleSnippet).toHaveBeenCalledTimes(1);
  });
});
