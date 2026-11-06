import { devServerUrl } from "../utils/preview-url.ts";
import { emit } from "../app-bridge.ts";

// Dev serverプレビューをOpen URLダイアログ（Open/コピー）で開く。TerminalPaneの
// Server pill（useInfoPillActions.ts）とDev Server設定一覧（SessionPreviewTab.vue）
// の両方から同じ挙動で使う。
export function useDevServerOpen() {
  function confirmOpenDevServer(p: Record<string, any>) {
    const url = devServerUrl(p, location.hostname);
    if (!url) return;
    emit("terminal:url", { uri: url, title: "Open preview server" });
  }

  return { confirmOpenDevServer };
}
