import { FLICK_THRESHOLD } from "./constants.ts";

type FlickActions = {
  up?: () => void;
  down?: () => void;
  left?: () => void;
  right?: () => void;
  tap?: () => void;
};

export function createFlickHandlers(actions: FlickActions = {}) {
  const { up, down, left, right, tap } = actions;
  let startX = 0;
  let startY = 0;
  return {
    onStart(e) {
      e.currentTarget.classList.add("pressed");
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    onEnd(e) {
      e.currentTarget.classList.remove("pressed");
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absY > absX && dy < -FLICK_THRESHOLD) up?.();
      else if (absY > absX && dy > FLICK_THRESHOLD) down?.();
      else if (absX > absY && dx < -FLICK_THRESHOLD) left?.();
      else if (absX > absY && dx > FLICK_THRESHOLD) right?.();
      else tap?.();
    },
  };
}
