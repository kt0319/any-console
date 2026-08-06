import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useToast } from "./useToast.js";
import { EP_PREVIEW_PORTS } from "../utils/endpoints.js";
import { devServerUrl } from "../utils/preview-url.js";

const POLL_INTERVAL_MS = 5000;
const seen = new Set();
let started = false;
let timer = null;
const ports = ref(/** @type {Record<string, any>[]} */ ([]));

// Preview Ports 設定画面（PreviewPorts.vue）を開いている間だけポーリングする
// （常時ポーリングだとサーバー側の実ポートスキャンが app 起動中ずっと回り続けてしまうため）。
export function usePreviewWatch() {
  const { apiGet } = useApi();
  const toast = useToast();

  async function poll(notify = true) {
    const { ok, data } = await apiGet(EP_PREVIEW_PORTS);
    if (!ok || !Array.isArray(data)) return;
    ports.value = data;
    const currentKeys = new Set(data.map((p) => `${p.session_id}:${p.port}`));
    // 検出済みから消えたものは seen から除外（次回出てきた時に再通知できる）
    for (const k of [...seen]) if (!currentKeys.has(k)) seen.delete(k);
    const newEntries = [];
    for (const p of data) {
      const key = `${p.session_id}:${p.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (notify) newEntries.push(p);
    }
    if (newEntries.length === 0) return;
    // iOS PWA はプログラム経由の window.open / a.click() を外部 Safari に流せない
    // ため、トーストでは通知だけして、タップで Preview 設定画面を開く。
    // ユーザがそこから物理タップでリンクを開けば Safari で起動する。
    const portLabel = (p) => (p.workspace ? `${p.port} (${p.workspace})` : `${p.port}`);
    let message;
    if (newEntries.length === 1) {
      const p = newEntries[0];
      const url = devServerUrl(p, window.location.hostname);
      message = url ? `Port ${portLabel(p)} detected\nPreview: ${url}` : `Port ${portLabel(p)} detected`;
    } else {
      message = `${newEntries.length} ports detected (${newEntries.map(portLabel).join(", ")})`;
    }
    toast.success(message, {
      duration: 6000,
      action: { event: "preview:showPorts" },
    });
  }

  async function start() {
    if (started) return;
    started = true;
    // 初回は通知なしで「既知」扱いに登録する。これによりパネルを開いた時点で
    // 既に動いてる dev サーバ群でトーストが大量に流れることを防ぐ。
    await poll(false);
    timer = setInterval(() => poll(true), POLL_INTERVAL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
    seen.clear();
    ports.value = [];
  }

  return { start, stop, ports };
}
