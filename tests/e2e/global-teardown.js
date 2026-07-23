import { execSync } from "node:child_process";
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

  // このランのユニークな tmux プレフィックスに一致するセッションを一掃する。
  // プレフィックスはラン固有なので、他ラン・実運用（ac-）のセッションには一致しない。
  // 各テストの cleanupNewSessions が原則後始末するため、ここはテスト中断時の保険。
  const tmuxPrefix = process.env.ANY_CONSOLE_E2E_TMUX_PREFIX;
  if (!tmuxPrefix) return;
  let names = "";
  try {
    names = execSync("tmux list-sessions -F '#{session_name}'", { encoding: "utf8" });
  } catch {
    return; // tmux サーバ未起動（= セッションなし）
  }
  for (const name of names.split("\n")) {
    if (!name.startsWith(tmuxPrefix)) continue;
    try {
      execSync(`tmux kill-session -t '${name}'`);
    } catch {
      // 既に消えている場合は無視
    }
  }
}
