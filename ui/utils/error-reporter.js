import { EP_CLIENT_ERRORS } from "./endpoints.js";

const DEDUP_WINDOW_MS = 5000;
const MAX_QUEUE_DURING_OUTAGE = 20;

const recent = new Map();
let posting = false;
const pending = [];

function pruneRecent(now) {
  for (const [key, ts] of recent) {
    if (now - ts > DEDUP_WINDOW_MS) recent.delete(key);
  }
}

function fingerprint(report) {
  return `${report.type}|${report.message}|${report.source}|${report.lineno ?? ""}`;
}

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

function buildReport({ type, message, stack, source, lineno, colno, info }) {
  return {
    type: truncate(type || "unknown", 40),
    message: truncate(message || "", 2000),
    stack: truncate(stack || "", 10000),
    source: truncate(source || "", 500),
    lineno: typeof lineno === "number" ? lineno : null,
    colno: typeof colno === "number" ? colno : null,
    url: truncate(typeof location !== "undefined" ? location.href : "", 500),
    user_agent: truncate(typeof navigator !== "undefined" ? navigator.userAgent : "", 500),
    info: truncate(info || "", 1000),
  };
}

async function post(report, authFetch) {
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

function reportFactory(authFetch) {
  return (raw) => {
    const report = buildReport(raw);
    const fp = fingerprint(report);
    const now = Date.now();
    pruneRecent(now);
    if (recent.has(fp)) return;
    recent.set(fp, now);
    post(report, authFetch);
  };
}

function extractStack(err) {
  if (!err) return "";
  if (typeof err === "string") return "";
  return err.stack || "";
}

function extractMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

export function installErrorReporter(app, authFetch) {
  if (typeof window === "undefined") return;
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

  window.addEventListener("error", (e) => {
    report({
      type: "error",
      message: e.message || extractMessage(e.error),
      stack: extractStack(e.error),
      source: e.filename || "",
      lineno: typeof e.lineno === "number" ? e.lineno : null,
      colno: typeof e.colno === "number" ? e.colno : null,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    report({
      type: "unhandledrejection",
      message: extractMessage(reason),
      stack: extractStack(reason),
    });
  });
}
