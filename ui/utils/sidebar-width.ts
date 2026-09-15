import {
  SESSION_SIDEBAR_DEFAULT_WIDTH_PX,
  SESSION_SIDEBAR_MIN_WIDTH_PX,
  SESSION_SIDEBAR_MAX_WIDTH_PX,
  SESSION_SIDEBAR_MAX_VIEWPORT_RATIO,
} from "./constants.ts";

export function sidebarMaxWidth(viewportWidth: number): number {
  return Math.max(SESSION_SIDEBAR_MIN_WIDTH_PX, Math.min(
    SESSION_SIDEBAR_MAX_WIDTH_PX, Math.floor(viewportWidth * SESSION_SIDEBAR_MAX_VIEWPORT_RATIO),
  ));
}

export function clampSidebarWidth(value: unknown, viewportWidth = Infinity): number {
  const width = typeof value === "number" && Number.isFinite(value)
    ? value : SESSION_SIDEBAR_DEFAULT_WIDTH_PX;
  return Math.max(SESSION_SIDEBAR_MIN_WIDTH_PX, Math.min(sidebarMaxWidth(viewportWidth), Math.round(width)));
}
