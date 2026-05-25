import { emit } from "../app-bridge.js";

/**
 * トースト通知を発火する薄い composable。`emit("toast:show", ...)` を
 * 全コンポーネントで個別に書くのを避け、呼び口を統一する。
 */
export function useToast() {
  function show(message, type = "info", opts = {}) {
    /** @type {{ message: string, type: string, duration?: number }} */
    const payload = { message, type };
    if (opts.duration != null) payload.duration = opts.duration;
    emit("toast:show", payload);
  }
  return {
    show,
    success: (message, opts) => show(message, "success", opts),
    error: (message, opts) => show(message, "error", opts),
    info: (message, opts) => show(message, "info", opts),
    warn: (message, opts) => show(message, "warn", opts),
  };
}
