import { emit } from "../app-bridge.ts";

interface ToastOptions {
  duration?: number;
  action?: string | object;
  key?: string;
}

interface ToastPayload {
  message: string;
  type: string;
  duration?: number;
  action?: string | object;
  key?: string;
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
    if (opts.key != null) payload.key = opts.key;
    emit("toast:show", payload);
  }
  /** 完了まで出しっぱなしにする情報トースト。同じ key の dismiss で消す。 */
  function showPending(message: string, key: string) {
    show(message, "info", { duration: 0, key });
  }
  function dismiss(key: string) {
    emit("toast:dismiss", { key });
  }
  return {
    show,
    showPending,
    dismiss,
    success: (message: string, opts?: ToastOptions) => show(message, "success", opts),
    error: (message: string, opts?: ToastOptions) => show(message, "error", opts),
    info: (message: string, opts?: ToastOptions) => show(message, "info", opts),
    warning: (message: string, opts?: ToastOptions) => show(message, "warning", opts),
  };
}
