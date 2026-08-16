import type { App } from "vue";
import { EP_CLIENT_ERRORS } from "./endpoints.ts";

const DEDUP_WINDOW_MS = 5000;
const MAX_QUEUE_DURING_OUTAGE = 20;

type ErrorReport = ReturnType<typeof buildReport>;
type AuthFetch = (endpoint: string, opts?: { method?: string, body?: unknown }) => Promise<Response | null>;

const recent = new Map<string, number>();
let posting = false;
const pending: ErrorReport[] = [];

export function pruneRecent(map: Map<string, number>, now: number, windowMs = DEDUP_WINDOW_MS) {
  for (const [key, ts] of map) {
    if (now - ts > windowMs) map.delete(key);
  }
}

export function fingerprint(report: { type: string, message: string, source: string, lineno?: number | null }) {
  return `${report.type}|${report.message}|${report.source}|${report.lineno ?? ""}`;
}

export function truncate(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

export function buildReport(
  { type, message, stack, source, lineno, colno, info }: {
    type?: string,
    message?: string,
    stack?: string,
    source?: string,
    lineno?: number | null,
    colno?: number | null,
    info?: string,
  },
  env: { href?: string, userAgent?: string } = {},
) {
  const href = env.href ?? (typeof location !== "undefined" ? location.href : "");
  const ua = env.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return {
    type: truncate(type || "unknown", 40),
    message: truncate(message || "", 2000),
    stack: truncate(stack || "", 10000),
    source: truncate(source || "", 500),
    lineno: typeof lineno === "number" ? lineno : null,
    colno: typeof colno === "number" ? colno : null,
    url: truncate(href, 500),
    user_agent: truncate(ua, 500),
    info: truncate(info || "", 1000),
  };
}

async function post(report: ErrorReport, authFetch: AuthFetch) {
  if (posting) {
    if (pending.length < MAX_QUEUE_DURING_OUTAGE) pending.push(report);
    return;
  }
  posting = true;
  try {
    await authFetch(EP_CLIENT_ERRORS, { method: "POST", body: report });
  } catch {
    // never surface error-reporter failures
  } finally {
    posting = false;
    const next = pending.shift();
    if (next) post(next, authFetch);
  }
}

function reportFactory(authFetch: AuthFetch) {
  return (raw: Parameters<typeof buildReport>[0]) => {
    const report = buildReport(raw);
    const fp = fingerprint(report);
    const now = Date.now();
    pruneRecent(recent, now);
    if (recent.has(fp)) return;
    recent.set(fp, now);
    post(report, authFetch);
  };
}

export function extractStack(err: unknown) {
  if (!err) return "";
  if (typeof err === "string") return "";
  return (err as { stack?: string }).stack || "";
}

export function extractMessage(err: unknown) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return (err as { message?: string }).message || String(err);
}

export function installErrorReporter(app: App, authFetch: AuthFetch) {
  if (typeof window === "undefined") return () => {};
  const report = reportFactory(authFetch);

  app.config.errorHandler = (err, _instance, info) => {
    report({
      type: "vue",
      message: extractMessage(err),
      stack: extractStack(err),
      info: info || "",
    });
    console.error(err);
  };

  const onError = (e: ErrorEvent) => {
    report({
      type: "error",
      message: e.message || extractMessage(e.error),
      stack: extractStack(e.error),
      source: e.filename || "",
      lineno: typeof e.lineno === "number" ? e.lineno : null,
      colno: typeof e.colno === "number" ? e.colno : null,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    report({
      type: "unhandledrejection",
      message: extractMessage(reason),
      stack: extractStack(reason),
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    app.config.errorHandler = undefined;
  };
}
