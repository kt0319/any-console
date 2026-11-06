import { IMAGE_TAP_ZOOM_LEVELS, IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN } from "./constants.ts";

type TouchPoint = { clientX: number, clientY: number };

export function pinchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function clampImageZoom(zoom: number): number {
  return Math.min(Math.max(zoom, IMAGE_ZOOM_MIN), IMAGE_ZOOM_MAX);
}

/** ピンチ開始時の倍率と指の間隔から、現在の指の間隔に対応する倍率を返す。 */
export function pinchZoom(startZoom: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return startZoom;
  return clampImageZoom(startZoom * (currentDistance / startDistance));
}

/** トラックパッドのピンチ（ctrlKey 付き wheel）の deltaY から倍率を返す。 */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampImageZoom(zoom * Math.exp(-deltaY * 0.01));
}

/** タップで切り替える段階のうち、現在より大きい次の倍率を返す。最大段階を超えていれば最小段階に戻る。 */
export function nextTapZoom(zoom: number): number {
  return IMAGE_TAP_ZOOM_LEVELS.find((level) => level > zoom) ?? IMAGE_TAP_ZOOM_LEVELS[0];
}
