import { devServerUrl } from "../utils/preview-url.ts";
import { emit } from "../app-bridge.ts";

// Dev server プレビューを Open URL ダイアログで開く（Server pill と Dev Server 設定一覧で共用）。
export function useDevServerOpen() {
  function confirmOpenDevServer(p: Record<string, any>) {
    const url = devServerUrl(p, location.hostname);
    if (!url) return;
    emit("terminal:url", { uri: url, title: "Open preview server" });
  }

  return { confirmOpenDevServer };
}
