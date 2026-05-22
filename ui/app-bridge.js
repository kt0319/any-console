import { debugLog } from "./composables/useClientLogs.js";

const bus = new EventTarget();

export function emit(event, detail) {
  debugLog("[Event]", event, detail ?? "");
  bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event, handler) {
  const wrapper = (e) => handler(e.detail);
  bus.addEventListener(event, wrapper);
  return () => bus.removeEventListener(event, wrapper);
}
