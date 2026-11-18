import { describe, it, expect } from "vitest";
import { pinchDistance, pinchZoom, clampImageZoom, wheelZoom, nextTapZoom, stepZoom } from "../../ui/utils/pinch-zoom.ts";
import { IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN } from "../../ui/utils/constants.ts";

describe("pinch-zoom", () => {
  it("2点間の距離を返す", () => {
    expect(pinchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
  });

  it("指の間隔の比で倍率が決まり、範囲内に収める", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
    expect(pinchZoom(1, 100, 100000)).toBe(IMAGE_ZOOM_MAX);
    expect(pinchZoom(1, 100, 1)).toBe(IMAGE_ZOOM_MIN);
  });

  it("開始時の間隔が0なら倍率を変えない", () => {
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
  });

  it("wheelZoom は deltaY が負で拡大・正で縮小し、範囲内に収める", () => {
    expect(wheelZoom(1, -50)).toBeGreaterThan(1);
    expect(wheelZoom(1, 50)).toBeLessThan(1);
    expect(clampImageZoom(100)).toBe(IMAGE_ZOOM_MAX);
  });

  it("nextTapZoom は 1 → 1.25 → 1.5 → 1.75 → 2 → 2.5 → 3 → 4 → 1 で巡回し、ピンチ後の中途半端な倍率からも次の段階へ進む", () => {
    const cycle = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 1];
    for (let i = 0; i < cycle.length - 1; i++) expect(nextTapZoom(cycle[i])).toBe(cycle[i + 1]);
    expect(nextTapZoom(1.7)).toBe(1.75);
    expect(nextTapZoom(6)).toBe(1);
  });

  it("stepZoom は 0.25 刻みで増減し、範囲外には出ない", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(IMAGE_ZOOM_MAX, 1)).toBe(IMAGE_ZOOM_MAX);
    expect(stepZoom(IMAGE_ZOOM_MIN, -1)).toBe(IMAGE_ZOOM_MIN);
    expect(stepZoom(1.05, 1)).toBe(1.3);
  });
});
