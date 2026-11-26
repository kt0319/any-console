import { createApp } from "vue";
import { createPinia } from "pinia";
import "@mdi/font/css/materialdesignicons.min.css";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/tokyo-night-dark.css";
import "./styles/a11y.css";
import "./styles/drag-utils.css";
import "./styles/base.css";
import "./styles/dialog.css";
import "./styles/modal-shell.css";
import "./styles/command-list.css";
import "./styles/settings-form.css";
import "./styles/info-pills.css";
import "./styles/job-list.css";
import "./styles/workspace-group.css";
import "./styles/session-sidebar.css";
import { watch } from "vue";
import App from "./components/App.vue";
import { useAuthStore } from "./stores/auth.ts";
import { useWorkspaceStore } from "./stores/workspace.ts";
import { useDispatchQueue } from "./composables/useDispatchQueue.ts";
import { dispatchWorkspaceLabel } from "./utils/dispatch-request.ts";
import { installErrorReporter } from "./utils/error-reporter.ts";
import { installTooltip } from "./utils/tooltip.ts";
import { installTapHaptics } from "./utils/tap-haptics.ts";
import { emit } from "./app-bridge.ts";
import { safeJsonLoad } from "./utils/storage.ts";
import { reloadIfNewBuild } from "./utils/build-update.ts";
import { CHUNK_RELOAD_GUARD_MS, FONT_LOAD_TIMEOUT_MS, LS_KEY_NOTIF_PREFS } from "./utils/constants.ts";

// 古い index.html のキャッシュで dynamic chunk が 404 になる（Safari の "Load failed"）ため、一度だけ自動リロードする。
// ループ回避は sessionStorage でガード。
function installChunkErrorAutoReload() {
  const RELOAD_GUARD_KEY = "__ac_chunk_reload_at__";
  function tryReload() {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
      if (Date.now() - last < CHUNK_RELOAD_GUARD_MS) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch { /* private mode 等 */ }
    location.reload();
  }
  function isChunkError(msg: unknown) {
    if (!msg) return false;
    const s = String(msg).toLowerCase();
    return s.includes("dynamically imported module")
      || s.includes("loading chunk")
      || s.includes("failed to fetch")
      || s.includes("importing a module script failed");
  }
  window.addEventListener("error", (e) => {
    if (isChunkError(e?.message) || isChunkError(e?.error?.message)) tryReload();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (isChunkError(e?.reason?.message || e?.reason)) tryReload();
  });
}

installChunkErrorAutoReload();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) reloadIfNewBuild().catch((e) => console.error("reloadIfNewBuild failed:", e));
});
installTooltip();
installTapHaptics();

async function bootstrap() {
  // xterm.js が文字幅を測る前にロードしておく（未ロードだとフォールバック幅で grid が決まりカーソル位置がずれる）。
  if (document.fonts?.load) {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('1em "Hack Nerd Font"'),
          document.fonts.load('bold 1em "Hack Nerd Font"'),
        ]),
        new Promise((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
      ]);
    } catch { /* ignore */ }
  }

  const container = document.getElementById("app");
  if (container) {
    const app = createApp(App);
    app.use(createPinia());
    const auth = useAuthStore();
    installErrorReporter(app, auth.apiFetch.bind(auth));
    app.mount(container);
    openDispatchQueueFromUrlIfRequested();
  }
}

// dispatch通知タップ時、ワークスペース詳細のDispatchタブへ直接開く。起動直後はdispatchキューが未着のことがあるため届くまで待つ。
function openDispatchRunView(dispatchId: string) {
  const { queue, recent } = useDispatchQueue();
  const workspaceStore = useWorkspaceStore();
  function tryOpen() {
    const item = queue.value.find((q) => q.id === dispatchId) || recent.value.find((r) => r.id === dispatchId);
    const wsName = item ? dispatchWorkspaceLabel(item.request) : "";
    if (!wsName) return false;
    workspaceStore.selectedWorkspace = wsName;
    emit("git:openFileModal", { pane: "dispatch", dispatchItemId: dispatchId });
    return true;
  }
  if (tryOpen()) return;
  const stopWatch = watch(queue, () => {
    if (tryOpen()) stopWatch();
  });
}

// 新規ウィンドウで開かれた場合は sw.js の postMessage が届かないため、起動時にURLパラメータで判定する。
function openDispatchQueueFromUrlIfRequested() {
  const params = new URLSearchParams(location.search);
  if (params.get("openDispatchQueue") !== "1") return;
  const dispatchId = params.get("dispatchId") || null;
  if (!dispatchId) return;
  openDispatchRunView(dispatchId);
}

bootstrap();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
  // 通知タイプ設定をSWへ同期する。設定画面を開いた時だけだと、永続化前の端末が初期値（全てオン）のままpushを表示するため起動時にも送る。
  navigator.serviceWorker.ready
    .then((reg) => {
      const prefs = safeJsonLoad(LS_KEY_NOTIF_PREFS, null);
      if (prefs) reg.active?.postMessage({ type: "sync-notif-prefs", prefs });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "notification-navigate") {
      emit("notification:openSession", { sessionId: event.data.sessionId });
    } else if (event.data?.type === "notification-open-dispatch-queue") {
      // sw.js へ受信を ack する（届いていればURL遷移フォールバックを起こさせないため）。
      event.ports?.[0]?.postMessage("ack");
      const dispatchId = event.data.dispatchId || null;
      if (dispatchId) openDispatchRunView(dispatchId);
    }
  });
}
