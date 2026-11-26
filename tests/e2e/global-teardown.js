import { execSync } from "node:child_process";
import fs from "node:fs";

/**
 * 使い捨てサーバモードで作った一時 data ディレクトリを片付ける。外部サーバモード（ANY_CONSOLE_URL 指定）では何もしない。
 * webServer 停止は globalTeardown より後のため、サーバが書き戻したファイルが残ることがある（一時領域なので無害）。
 */
export default function globalTeardown() {
  const dir = process.env.ANY_CONSOLE_E2E_DATA_DIR;
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });

  // このランの tmux プレフィックスに一致するセッションを一掃する。各テストの後始末の保険（中断時用）。
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
