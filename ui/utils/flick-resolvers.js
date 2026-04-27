export const arrowResolver = (dx, dy, threshold) => {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
    return dx < 0 ? { key: "ArrowLeft" } : { key: "ArrowRight" };
  }
  if (Math.abs(dy) > threshold && dy < 0) return { key: "ArrowUp" };
  if (Math.abs(dy) > threshold && dy > 0) return { key: "ArrowDown" };
  return null;
};

export const enterResolver = (dx, dy, threshold) => {
  if (Math.abs(dy) > Math.abs(dx) && dy < -threshold) return { key: "Tab" };
  if (Math.abs(dy) > Math.abs(dx) && dy > threshold) return { key: " " };
  if (Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { key: "Backspace" };
  if (Math.abs(dx) > Math.abs(dy) && dx > threshold) return { key: "Delete" };
  return null;
};
