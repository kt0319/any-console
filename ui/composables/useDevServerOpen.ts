import { useConfirm } from "./useConfirm.ts";
import { devServerUrl } from "../utils/preview-url.ts";
import { openExternal } from "../utils/open-external.ts";
import { copyText } from "../utils/clipboard.ts";

// Dev serverプレビューを開く前の確認（Open/Copy選択式）。TerminalPaneの
// Server pill（useInfoPillActions.ts）とDev Server設定一覧（SessionPreviewTab.vue）
// の両方から同じ挙動で使う。
export function useDevServerOpen() {
  const { confirm } = useConfirm();

  async function confirmOpenDevServer(p: Record<string, any>) {
    const url = devServerUrl(p, location.hostname);
    if (!url) return;
    const result = await confirm(`Open dev server preview at "${url}"?`, {
      ok: { label: "Open" },
      extra: { label: "Copy", value: "copy", icon: "mdi-content-copy" },
    });
    if (result === "copy") {
      await copyText(url);
      return;
    }
    if (!result) return;
    openExternal(url);
  }

  return { confirmOpenDevServer };
}
