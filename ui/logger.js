function addLog() {}

async function sendClientLog(category, action, detail = {}) {
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
