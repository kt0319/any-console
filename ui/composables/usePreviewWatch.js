import { useApi } from "./useApi.js";
import { useToast } from "./useToast.js";

const POLL_INTERVAL_MS = 5000;
const seen = new Set();
let started = false;
let timer = null;

export function usePreviewWatch() {
  const { apiGet } = useApi();
  const toast = useToast();

  async function poll(notify = true) {
    const { ok, data } = await apiGet("/preview/ports");
    if (!ok || !Array.isArray(data)) return;
    const currentKeys = new Set(data.map((p) => `${p.session_id}:${p.port}`));
    // 検出済みから消えたものは seen から除外（次回出てきた時に再通知できる）
    for (const k of [...seen]) if (!currentKeys.has(k)) seen.delete(k);
    for (const p of data) {
      const key = `${p.session_id}:${p.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!notify) continue;
      // iOS PWA はプログラム経由の window.open / a.click() を外部 Safari に流せない
      // ため、トーストでは通知だけして、タップで Preview 設定画面を開く。
      // ユーザがそこから物理タップでリンクを開けば Safari で起動する。
      toast.success(`Port ${p.port} detected`, {
        duration: 6000,
        action: { event: "preview:showConfig" },
      });
    }
  }

  async function start() {
    if (started) return;
    started = true;
    // 初回は通知なしで「既知」扱いに登録する。これにより app 起動時に
    // 既に動いてる dev サーバ群でトーストが大量に流れることを防ぐ。
    await poll(false);
    timer = setInterval(() => poll(true), POLL_INTERVAL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
    seen.clear();
  }

  return { start, stop };
}
