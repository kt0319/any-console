export function isPastDragThreshold(dx, dy, threshold) {
  return dx * dx + dy * dy > threshold * threshold;
}
