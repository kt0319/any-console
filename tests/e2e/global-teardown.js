import fs from "node:fs";

/**
 * 使い捨てサーバモード（playwright.config.js 参照）で作った一時 data ディレクトリを
 * 片付ける。外部サーバモード（ANY_CONSOLE_URL 指定）では何もしない。
 *
 * Playwright の webServer 停止は globalTeardown より後なので、サーバが終了時に
 * 書き戻したファイルが一部残ることがある。OS の一時領域なので残っても無害。
 * （他ランを巻き込まないよう、削除対象はこの実行が作ったディレクトリのみ）
 */
export default function globalTeardown() {
  const dir = process.env.ANY_CONSOLE_E2E_DATA_DIR;
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });
}
