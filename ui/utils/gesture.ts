export function isPastDragThreshold(dx: number, dy: number, threshold: number): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

type GestureEvent = TouchEvent | MouseEvent;

export function createTouchTracker() {
  let startX = 0;
  let startY = 0;
  return {
    start(e: GestureEvent) {
      const t = "touches" in e ? (e.touches?.[0] ?? e) : e;
      startX = t.clientX || 0;
      startY = t.clientY || 0;
    },
    delta(e: GestureEvent) {
      const t = "changedTouches" in e ? (e.changedTouches?.[0] ?? e.touches?.[0] ?? e) : e;
      return { dx: (t.clientX || 0) - startX, dy: (t.clientY || 0) - startY };
    },
  };
}
