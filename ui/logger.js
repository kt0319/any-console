// @ts-check
import { token } from './state-core.js';
import { apiFetch } from './api-client.js';

/**
 * Send a structured log entry to the server's client-log endpoint.
 * Silently ignores failures to avoid cascading errors.
 *
 * @param {string} category - High-level category (e.g. "error", "git", "terminal")
 * @param {string} action - Specific action or event name within the category
 * @param {Record<string, unknown>} [detail] - Optional key/value payload for the log entry
 * @returns {Promise<void>}
 */
export async function sendClientLog(category, action, detail = {}) {
  if (typeof apiFetch !== "function" || !token) return;
  try {
    await apiFetch("/logs/client", {
      method: "POST",
      body: { source: `${category}/${action}`, message: JSON.stringify(detail) },
    });
  } catch {}
}

window.onerror = (msg, source, line) => {
  sendClientLog("error", "js_exception", { msg: String(msg), source, line });
};

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  sendClientLog("error", "unhandled_rejection", { msg });
});
