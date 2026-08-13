export function isPastDragThreshold(dx, dy, threshold) {
  return dx * dx + dy * dy > threshold * threshold;
}

export function createTouchTracker() {
  let startX = 0;
  let startY = 0;
  return {
    start(e) {
      const t = e.touches?.[0] ?? e;
      startX = t.clientX || 0;
      startY = t.clientY || 0;
    },
    delta(e) {
      const t = e.changedTouches?.[0] ?? e.touches?.[0] ?? e;
      return { dx: (t.clientX || 0) - startX, dy: (t.clientY || 0) - startY };
    },
  };
}
