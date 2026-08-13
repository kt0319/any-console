import { emit } from "../app-bridge.js";

interface ToastOptions {
  duration?: number;
  action?: string | object;
}

interface ToastPayload {
  message: string;
  type: string;
  duration?: number;
  action?: string | object;
}

/**
 * トースト通知を発火する薄い composable。`emit("toast:show", ...)` を
 * 全コンポーネントで個別に書くのを避け、呼び口を統一する。
 */
export function useToast() {
  function show(message: string, type: string = "info", opts: ToastOptions = {}) {
    const payload: ToastPayload = { message, type };
    if (opts.duration != null) payload.duration = opts.duration;
    if (opts.action != null) payload.action = opts.action;
    emit("toast:show", payload);
  }
  return {
    show,
    success: (message: string, opts?: ToastOptions) => show(message, "success", opts),
    error: (message: string, opts?: ToastOptions) => show(message, "error", opts),
    info: (message: string, opts?: ToastOptions) => show(message, "info", opts),
    warning: (message: string, opts?: ToastOptions) => show(message, "warning", opts),
  };
}
