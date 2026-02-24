const OP_LOG_MAX = 500;
const opLog = [];

function addLog(category, action, detail = {}) {
  opLog.push({ ts: Date.now(), cat: category, act: action, ...detail });
  if (opLog.length > OP_LOG_MAX) opLog.shift();
}

function getOpLog() { return opLog; }
function clearOpLog() { opLog.length = 0; }

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
  addLog("error", "js_exception", { msg: String(msg), source, line });
  sendClientLog("error", "js_exception", { msg: String(msg), source, line });
};

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  addLog("error", "unhandled_rejection", { msg });
  sendClientLog("error", "unhandled_rejection", { msg });
});
