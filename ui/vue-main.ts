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
import "./styles/session-sidebar.css";
import { watch } from "vue";
import App from "./components/App.vue";
import { useAuthStore } from "./stores/auth.ts";
import { useWorkspaceStore } from "./stores/workspace.ts";
import { useDispatchQueue } from "./composables/useDispatchQueue.ts";
import { dispatchWorkspaceLabel } from "./utils/dispatch-request.ts";
import { installErrorReporter } from "./utils/error-reporter.ts";
import { installTooltip } from "./utils/tooltip.ts";
import { emit } from "./app-bridge.ts";
import { safeJsonLoad } from "./utils/storage.ts";
import { LS_KEY_NOTIF_PREFS } from "./utils/constants.ts";

// 古い index.html がキャッシュされたまま新ビルドの asset hash を踏むと、
// dynamic chunk の読み込みが 404 になり Safari が "Load failed" を出す。
// 検知したら一度だけ自動リロードして新しい hash を取りに行く。
// （ループ回避のため sessionStorage でガード）
function installChunkErrorAutoReload() {
  const RELOAD_GUARD_KEY = "__ac_chunk_reload_at__";
  function tryReload() {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
      if (Date.now() - last < 10000) return;  // 直近10秒以内はループ防止
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
installTooltip();

async function bootstrap() {
  // xterm.js が文字幅を測る前に Hack Nerd Font をロードしておく。
  // 未ロードのまま Terminal を生成するとフォールバック幅で grid が決まり、
  // カーソル位置が徐々にずれる症状が出る。
  if (document.fonts?.load) {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('1em "Hack Nerd Font"'),
          document.fonts.load('bold 1em "Hack Nerd Font"'),
        ]),
        new Promise((resolve) => setTimeout(resolve, 3000)),
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

// dispatch通知タップ時、該当リクエストをワークスペース詳細のDispatchタブへ
// 直接開く（DispatchRunViewはSettings側の画面ではなくWorkspaceDetail.vue内の
// ローカル表示のため、対象ワークスペースを解決してからgit:openFileModalで開く）。
// 起動直後はまだdispatchキューがWSで届いていないことがあるため、届くまで待つ。
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

// 既存タブが無く新規ウィンドウが開かれた場合（sw.js の
// notification-open-dispatch-queue は既存クライアント向けの postMessage のため届かない）
// でも該当リクエストを開けるように、起動時にURLパラメータで判定する。
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
  // 通知タイプ設定をSWへ同期する（SW側でCache Storageへ永続化される）。
  // 設定画面を開いた時だけの同期だと、SW更新等で永続化前の端末が
  // 初期値（全てオン）のままpushを表示してしまうため、起動時にも送る。
  navigator.serviceWorker.ready
    .then((reg) => {
      const prefs = safeJsonLoad(LS_KEY_NOTIF_PREFS, null);
      if (prefs) reg.active?.postMessage({ type: "sync-notif-prefs", prefs });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "notification-navigate") {
      emit("notification:open-session", { sessionId: event.data.sessionId });
    } else if (event.data?.type === "notification-open-dispatch-queue") {
      // sw.js へ受信を ack する（届いていればURL遷移フォールバックを起こさせないため）。
      event.ports?.[0]?.postMessage("ack");
      const dispatchId = event.data.dispatchId || null;
      if (dispatchId) openDispatchRunView(dispatchId);
    }
  });
}
