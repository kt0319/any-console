import { describe, it, expect } from "vitest";
import { pinchDistance, pinchZoom, clampImageZoom, wheelZoom } from "../../ui/utils/pinch-zoom.ts";
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
});
