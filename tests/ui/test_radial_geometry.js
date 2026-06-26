// @ts-check
import { describe, it, expect } from "vitest";
import {
  RADIAL_ANGLES,
  SPECIAL_POSITIONS,
  SPECIAL_BUTTON_SIZE,
  specialIdAt,
  sectorIndexFromDelta,
} from "../../ui/utils/radial-geometry.js";

describe("radial-geometry constants", () => {
  it("exposes 8 sector angles and 4 special positions", () => {
    expect(RADIAL_ANGLES).toHaveLength(8);
    expect(SPECIAL_POSITIONS).toHaveLength(4);
    expect(SPECIAL_BUTTON_SIZE).toEqual({ width: 80, height: 34 });
  });
});

describe("sectorIndexFromDelta", () => {
  it("returns null inside the deadzone", () => {
    expect(sectorIndexFromDelta(0, 0)).toBeNull();
    expect(sectorIndexFromDelta(10, 10)).toBeNull();
  });

  it("maps up to sector 0 (-90deg)", () => {
    expect(sectorIndexFromDelta(0, -60)).toBe(0);
  });

  it("maps right to sector 2 (0deg)", () => {
    expect(sectorIndexFromDelta(60, 0)).toBe(2);
  });

  it("maps down to sector 4 (90deg)", () => {
    expect(sectorIndexFromDelta(0, 60)).toBe(4);
  });

  it("maps left to sector 6 (180deg)", () => {
    expect(sectorIndexFromDelta(-60, 0)).toBe(6);
  });

  it("returns null in the gap between sectors", () => {
    // 真上(-90)と右上(-45)の中間 ≒ -67.5°。どちらの中心からも 18° 超離れる。
    expect(sectorIndexFromDelta(23, -55.5)).toBeNull();
  });
});

describe("specialIdAt", () => {
  it("returns null near the origin", () => {
    expect(specialIdAt(0, 0)).toBeNull();
  });

  it("matches each corner button by index", () => {
    expect(specialIdAt(-100, -100)).toBe("special:0");
    expect(specialIdAt(100, -100)).toBe("special:1");
    expect(specialIdAt(-100, 100)).toBe("special:2");
    expect(specialIdAt(100, 100)).toBe("special:3");
  });

  it("returns null just outside a button's bounds", () => {
    // 右下ボタン中心(100,100)・幅80高34なので、x=100+41 は範囲外。
    expect(specialIdAt(141, 100)).toBeNull();
  });
});
