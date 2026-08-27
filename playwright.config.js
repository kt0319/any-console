import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// any-console の E2E スモーク設定。CI（.github/workflows/ci.yml の e2e ジョブ）と
// ローカル手動実行の両方で使う。
//
// サーバは 2 モード:
// - ANY_CONSOLE_URL 指定時: 起動済みの外部サーバに対して実行する。
//   認証トークンは ANY_CONSOLE_TOKEN env、もしくは data/auth.json から読む。
// - 未指定時（既定）: 一時ディレクトリを data 領域にした使い捨てサーバを
//   ランごとに割り当てた空きポートで自動起動する（ANY_CONSOLE_DATA_DIR 隔離モード）。
//   実運用の data/・config.json には一切触れないため、後始末漏れがサーバ状態を
//   汚す心配がない。サーバ実行には `server/target/release/any-console-server`
//   （事前に `cargo build --release` が必要）と tmux が必要。バイナリパスは
//   ANY_CONSOLE_E2E_BIN で上書き可能。

const E2E_TOKEN = "e2e-ephemeral-token";
const E2E_DATA_DIR_PREFIX = "any-console-e2e-";

// ランごとに OS から空きポートを割り当てる（固定ポートだと並行ランや既存プロセスと
// 衝突し、reuseExistingServer: false の webServer が起動前に失敗するため）。
// bind→close 後に他プロセスへ取られる僅かな競合窓は許容する（その場合も
// サーバ起動エラーとして顕在化するだけで、誤った対象へのテストにはならない）。
function allocateFreePort() {
  const script =
    "const s=require('net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  return Number(execSync(`node -e "${script}"`, { encoding: "utf8" }).trim());
}

// 使い捨てサーバモードのセットアップ。この config はワーカープロセスでも再評価されるが、
// ワーカーは main プロセスが設定した ANY_CONSOLE_URL を env 継承するため、
// このブロックは main プロセスで一度しか走らない（一時ディレクトリの二重作成を防ぐ）。
// --list（エディタ拡張等のテスト discovery）は globalTeardown が走らないため、
// 使い捨て領域を作るとそのまま溜まり続ける。discovery ではサーバ不要なので作らない。
const LIST_ONLY = process.argv.includes("--list");

let webServer;
if (!process.env.ANY_CONSOLE_URL && !LIST_ONLY) {
  // 掃除は global-teardown.js が「この実行が作ったディレクトリ」だけを対象に行う。
  // プレフィックス一致での一括削除はしない（並行実行中の別ランの data 領域や、
  // spec が作る any-console-e2e-ws-* / any-console-e2e-git-* を巻き込むため）。
  const port = allocateFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), E2E_DATA_DIR_PREFIX));
  // tmux セッション名前空間もランごとに分離する（既定の "ac-" のままだと
  // ホスト tmux を共有する並行ランや実運用のセッションを列挙・巻き込みうるため）。
  const tmuxPrefix = `ac-e2e${crypto.randomBytes(3).toString("hex")}-`;
  fs.writeFileSync(path.join(dataDir, "auth.json"), JSON.stringify({ token: E2E_TOKEN }));
  // bind 先とポートは隔離側 config.json で指定する（実運用の config.json は読まれない）
  fs.writeFileSync(
    path.join(dataDir, "config.json"),
    JSON.stringify({ __global__: { config_version: 1, host: "127.0.0.1", port } }),
  );
  process.env.ANY_CONSOLE_URL = `http://127.0.0.1:${port}`;
  process.env.ANY_CONSOLE_TOKEN = E2E_TOKEN;
  process.env.ANY_CONSOLE_E2E_DATA_DIR = dataDir; // global-teardown.js が削除する
  process.env.ANY_CONSOLE_E2E_TMUX_PREFIX = tmuxPrefix; // global-teardown.js が残セッションを掃除する
  const rustBin =
    process.env.ANY_CONSOLE_E2E_BIN ||
    path.join(process.cwd(), "server", "target", "release", "any-console-server");
  webServer = {
    command: rustBin,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ANY_CONSOLE_DATA_DIR: dataDir,
      ANY_CONSOLE_TMUX_PREFIX: tmuxPrefix,
      // E2E は短時間に多数のリクエストを送るため、レート制限(既定 1000req/60s)を引き上げる
      ANY_CONSOLE_RATE_LIMIT: "2000",
    },
  };
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.js",
  webServer,
  // ヘッドレス、Chromium のみ（個人ツール用途で十分）
  use: {
    baseURL: process.env.ANY_CONSOLE_URL,
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Playwright 管理外の Chromium を使う環境（プリインストール済みバイナリ等）向けの上書き。
    // 未設定なら通常どおり playwright install した Chromium を使う。
    launchOptions: process.env.ANY_CONSOLE_E2E_CHROMIUM
      ? { executablePath: process.env.ANY_CONSOLE_E2E_CHROMIUM }
      : {},
  },
  reporter: [["list"]],
  // 並列度は控えめ（tmux セッション共有なので衝突回避）。
  workers: 1,
  retries: 0,
  timeout: 30_000,
});
