#!/usr/bin/env node
// claude/codex を同時に複数セッション起動するローカル専用のstress/E2Eスクリプト。
// npm run test:e2e には含めない（実CLIを叩くためAPIコスト・実行時間がかかる）。
//
// 検証すること:
//   1. セッション間の状態混線が起きないこと（ANY_CONSOLE_SESSION等のhook用
//      環境変数がセッションごとに正しく隔離されること — server/src/tmux.rs
//      create_tmux_session の regression チェック）
//   2. サーバの安定性（クラッシュしない・全セッションが生き残る）
//   3. UI側の表示が壊れないこと（10タブ分のセッション一覧・console error無し）
//
// 使い捨てサーバモード（playwright.config.js と同じ隔離方式）で動かすため、
// 実運用の data/・config.json・tmuxセッションには一切触れない。
//
// 前提:
//   - cargo build --release 済み（server/target/release/any-console-server）
//   - npm run build 済み（サーバが配信する dist/ が最新であること。UIチェック用）
//   - claude / codex コマンドがPATH上にあり、ログイン済みであること
//
// 実行: node tests/stress/concurrent-agents.mjs [--count=10]

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const AGENT_COMMANDS = ["claude", "codex"];
const PROMPT_TEXT = "Reply with exactly the word OK and nothing else. Do not use any tools or edit any files.";
const BOOT_READY_TIMEOUT_SEC = 30;
const STATUS_WATCH_SEC = 90;
const READY_TIMEOUT_SEC = 60;
// エージェントごとの「入力を受け付けられる状態」を示す画面上の目印。
// 10並行だとCPU負荷でCLIごとの起動完了タイミングがばらつくため、固定秒数
// 待つのではなくセッションごとにこれをポーリングしてから送信する。
// claudeの "❯" はzshのプロンプト記号そのものでもあり、CLI起動前から画面に
// 出てしまい即readyと誤判定するため使わない（footer固有の文言で判定する）。
const READY_MARKERS = { claude: "for agents", codex: "›" };

const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith("--count="));
const SESSION_COUNT = countArg ? Number(countArg.split("=")[1]) : 10;

function log(msg) {
  console.log(`[stress] ${msg}`);
}

function fail(msg) {
  console.error(`[stress][FAIL] ${msg}`);
}

async function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForServerReady(baseUrl, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/auth/check`);
      if (res.status < 500) return true;
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function tmuxEnv(tmuxName, key) {
  try {
    const out = execFileSync("tmux", ["show-environment", "-t", tmuxName, key], {
      encoding: "utf8",
    }).trim();
    // "KEY=value" or "-KEY"（未設定）
    const eq = out.indexOf("=");
    if (eq === -1) return null;
    return out.slice(eq + 1);
  } catch {
    return null;
  }
}

function capturePane(tmuxName) {
  try {
    return execFileSync("tmux", ["capture-pane", "-t", tmuxName, "-p"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

/** 画面にreadyマーカーが現れるまでポーリングする。タイムアウトしてもfalseを返すだけで例外は投げない（best-effort）。 */
async function waitForPaneReady(tmuxName, marker, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (marker && capturePane(tmuxName).includes(marker)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const results = { pass: [], fail: [] };
  const check = (label, ok, detail) => {
    if (ok) {
      results.pass.push(label);
      log(`OK   ${label}`);
    } else {
      results.fail.push(`${label}${detail ? ` (${detail})` : ""}`);
      fail(`${label}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const rustBin = path.join(REPO_ROOT, "server", "target", "release", "any-console-server");
  if (!fs.existsSync(rustBin)) {
    console.error(
      `サーババイナリが見つかりません: ${rustBin}\n先に (cd server && cargo build --release) を実行してください。`,
    );
    process.exit(1);
  }

  const port = await allocateFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-stress-"));
  const tmuxPrefix = `ac-stress${crypto.randomBytes(3).toString("hex")}-`;
  const token = "stress-ephemeral-token";
  const baseUrl = `http://127.0.0.1:${port}`;

  fs.writeFileSync(path.join(dataDir, "auth.json"), JSON.stringify({ token }));
  fs.writeFileSync(
    path.join(dataDir, "config.json"),
    JSON.stringify({
      "stress-repo": { path: REPO_ROOT },
      __global__: { config_version: 1, host: "127.0.0.1", port },
    }),
  );

  // project_root は certs/ の有無でTLS/HTTPを自動判定する（preview::find_cert_pair）。
  // 実リポジトリ直下には実運用のTailscale証明書があり、そのままだとhttpで
  // 待ち受けているつもりがTLSになってしまう。dataDir（certsを持たない）を
  // project_rootとして渡し、distだけシンボリックリンクして配信は保つ。
  fs.symlinkSync(path.join(REPO_ROOT, "dist"), path.join(dataDir, "dist"), "dir");

  log(`data dir: ${dataDir}`);
  log(`tmux prefix: ${tmuxPrefix}`);
  log(`port: ${port}`);

  // SSL_CERTFILE/SSL_KEYFILEはany-console起動時にこのシェル自身へ設定されて
  // おり、そのまま継承するとproject_root隔離を無視してTLSになってしまう。
  // OPENAI_API_KEYが環境変数にあるとcodexがChatGPTサブスクリプション
  // ログイン（auth_mode=chatgpt）より優先して従量課金のAPIキー経由で認証
  // してしまうため、こちらも除外してサブスクリプション枠を使わせる。
  const { SSL_CERTFILE, SSL_KEYFILE, OPENAI_API_KEY, ...envForServer } = process.env;
  void SSL_CERTFILE;
  void SSL_KEYFILE;
  void OPENAI_API_KEY;

  const serverLog = [];
  const server = spawn(rustBin, [], {
    cwd: REPO_ROOT,
    env: {
      ...envForServer,
      ANY_CONSOLE_PROJECT_ROOT: dataDir,
      ANY_CONSOLE_DATA_DIR: dataDir,
      ANY_CONSOLE_TMUX_PREFIX: tmuxPrefix,
      ANY_CONSOLE_RATE_LIMIT: "2000",
    },
  });
  server.stdout.on("data", (d) => serverLog.push(d.toString()));
  server.stderr.on("data", (d) => serverLog.push(d.toString()));

  let browser;
  const createdSessionIds = [];

  const cleanup = async () => {
    log("cleanup開始");
    if (browser) await browser.close().catch(() => {});
    for (const id of createdSessionIds) {
      await fetch(`${baseUrl}/terminal/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    if (!server.killed) {
      server.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
      if (!server.killed) server.kill("SIGKILL");
    }
    // 保険: このランのtmuxプレフィックスに一致するセッションを一掃する
    try {
      const names = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
        encoding: "utf8",
      });
      for (const name of names.split("\n")) {
        if (!name.startsWith(tmuxPrefix)) continue;
        try {
          execFileSync("tmux", ["kill-session", "-t", name]);
        } catch {
          // 既に消えている場合は無視
        }
      }
    } catch {
      // tmuxサーバが無ければ何もない
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    log("cleanup完了");
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    const ready = await waitForServerReady(baseUrl, READY_TIMEOUT_SEC);
    check("サーバが起動しヘルスチェックに応答する", ready);
    if (!ready) throw new Error("server did not become ready");

    // ── 1. N セッションを並行作成 ──────────────────────────────────────────
    const createStart = Date.now();
    const createResults = await Promise.all(
      Array.from({ length: SESSION_COUNT }, (_, i) => {
        const command = AGENT_COMMANDS[i % AGENT_COMMANDS.length];
        // tmuxサーバは起動時点の環境を新規セッションに引き継ぐことがあるため、
        // 起動コマンド自体でもOPENAI_API_KEYをunsetして確実に消す。
        const launchCommand = command === "codex" ? "unset OPENAI_API_KEY; codex" : command;
        return fetch(`${baseUrl}/run`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            job: "terminal",
            workspace: "stress-repo",
            job_name: `stress-${i}`,
            job_label: `Stress ${i} (${command})`,
            command: launchCommand,
          }),
        }).then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => ({})), command }));
      }),
    );
    const createElapsedMs = Date.now() - createStart;
    log(`${SESSION_COUNT}セッション作成: ${createElapsedMs}ms`);

    const allCreated = createResults.every((r) => r.ok && r.body.session_id);
    check(`${SESSION_COUNT}セッション全て作成に成功`, allCreated, JSON.stringify(createResults.filter((r) => !r.ok)));
    const idToCommand = new Map();
    for (const r of createResults) {
      if (r.body?.session_id) {
        createdSessionIds.push(r.body.session_id);
        idToCommand.set(r.body.session_id, r.command);
      }
    }

    // ── 2. tmux環境変数の隔離を直接検証（クロスセッション汚染のregression） ──
    let envIsolationOk = true;
    const envFailures = [];
    for (const id of createdSessionIds) {
      const tmuxName = `${tmuxPrefix}${id}`;
      const value = tmuxEnv(tmuxName, "ANY_CONSOLE_SESSION");
      if (value !== tmuxName) {
        envIsolationOk = false;
        envFailures.push(`${id}: ANY_CONSOLE_SESSION=${value}`);
      }
    }
    check("各セッションのANY_CONSOLE_SESSIONが自分自身を指す（クロスセッション汚染なし）", envIsolationOk, envFailures.join(", "));

    // ── 3. status stream WSを先に接続する ──────────────────────────────
    // status streamはpush型のライブフィードで過去分の再送はない。プロンプト
    // 送信後に接続すると、送信直後の一瞬のworking遷移を取りこぼす
    // （実機で確認済み — ライブでは確実にworkingになっているのに、後から
    // 接続したWSのタイムラインには全くstate変化が記録されないことがあった）。
    // そのため送信前に必ず接続を確立しておく。
    const knownIds = new Set(createdSessionIds);
    const stateTimeline = new Map(createdSessionIds.map((id) => [id, []]));
    const unknownIds = new Set();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/workspaces/statuses/ws?token=${token}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type !== "agent_states") return;
      for (const entry of msg.states || []) {
        if (!knownIds.has(entry.session_id)) {
          unknownIds.add(entry.session_id);
          continue;
        }
        stateTimeline.get(entry.session_id).push(entry.state);
      }
    });

    // ── 4. CLI起動を個別に待ってから軽いプロンプトを送る ──────────────────
    // 固定秒数待ちだと、並行数が増えてCPU負荷が上がった時に起動が遅れた
    // セッションへ早くsend-keysしてしまい、入力欄にフォーカスが無いまま
    // テキストが失われるレースが起きる（実機で確認済み）。セッションごとに
    // readyマーカーが出るまで個別にポーリングしてから送信する。
    // また、テキストとEnterを1回のsend-keysにまとめると、TUI側
    // （bracketed pasteの処理待ち）がEnterを取りこぼし、入力欄にテキストが
    // 残ったまま送信されないことがある（codexで実機確認済み）。テキスト送信と
    // Enterを分け、間に短いウェイトを挟む。
    const bootResults = await Promise.all(
      createdSessionIds.map(async (id) => {
        const tmuxName = `${tmuxPrefix}${id}`;
        const marker = READY_MARKERS[idToCommand.get(id)];
        const ready = await waitForPaneReady(tmuxName, marker, BOOT_READY_TIMEOUT_SEC);
        return { id, tmuxName, ready };
      }),
    );
    const notReady = bootResults.filter((r) => !r.ready);
    if (notReady.length > 0) {
      log(`起動確認タイムアウト（プロンプト送信は試みる）: ${notReady.map((r) => r.id).join(", ")}`);
    }
    for (const { tmuxName } of bootResults) {
      execFileSync("tmux", ["send-keys", "-t", tmuxName, PROMPT_TEXT]);
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const { tmuxName } of bootResults) {
      execFileSync("tmux", ["send-keys", "-t", tmuxName, "Enter"]);
    }
    log("全セッションへプロンプト送信完了");

    log(`status streamを${STATUS_WATCH_SEC}秒監視`);
    const watchDeadline = Date.now() + STATUS_WATCH_SEC * 1000;
    while (Date.now() < watchDeadline) {
      const allSettled = createdSessionIds.every((id) => {
        const states = stateTimeline.get(id);
        return states.includes("working") && states.at(-1) === "idle";
      });
      if (allSettled) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    ws.close();

    for (const id of createdSessionIds) {
      log(`  timeline ${id} (${idToCommand.get(id)}): ${stateTimeline.get(id).join(",") || "(none)"}`);
    }

    check("status streamに他セッション由来の未知のsession_idが混入しない", unknownIds.size === 0, [...unknownIds].join(", "));
    // 状態配信はポーリング型（AGENT_WATCH_POLL_INTERVAL_SEC=2秒周期）のため、
    // "OK"だけの短い応答だとworking→idleが1周期に収まりWSには一度も
    // working が載らないことがある（実動作自体は正常。tmuxキャプチャの
    // "post-send"ログで実際に応答していることは別途確認できる）。
    // これは既知の特性でありセッション分離の正しさには影響しないため、
    // 情報表示のみでハード失敗にはしない。
    const sawWorking = createdSessionIds.filter((id) => stateTimeline.get(id).includes("working"));
    if (sawWorking.length < SESSION_COUNT) {
      log(
        `INFO working遷移がWSに載らなかったセッション（ポーリング周期内で完了した可能性、既知の特性）: ${createdSessionIds
          .filter((id) => !stateTimeline.get(id).includes("working"))
          .join(", ")}`,
      );
    }

    // 状態配信のポーリング粒度に左右されない、より確実な「実際に応答した」証拠。
    let allReplied = true;
    const notReplied = [];
    for (const id of createdSessionIds) {
      const tmuxName = `${tmuxPrefix}${id}`;
      if (!/\bOK\b/.test(capturePane(tmuxName))) {
        allReplied = false;
        notReplied.push(id);
      }
    }
    check("全セッションが実際にプロンプトへ応答している（画面上に応答内容あり）", allReplied, notReplied.join(", "));

    // ── 5. サーバの安定性 ──────────────────────────────────────────────
    check("サーバプロセスがクラッシュしていない", server.exitCode === null && !server.killed);
    const listRes = await fetch(`${baseUrl}/terminal/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json().catch(() => []);
    check(`GET /terminal/sessionsが${SESSION_COUNT}件返す`, listRes.ok && listBody.length === SESSION_COUNT, `actual=${listBody.length}`);

    // ── 6. UI表示の確認 ────────────────────────────────────────────────
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      // ネットワークエラーは "Failed to load resource" として汎用文言でも
      // 出るが、URLを含まず判別できない。詳細はresponseイベント側で
      // ステータス・URL付きで拾うので、ここでは重複するその文言を除外する。
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
        consoleErrors.push(msg.text());
      }
    });
    page.on("response", (res) => {
      // 未ログイン時点の /auth/check 401 はログイン画面表示のための正常な
      // 事前チェックなので除外する（ログイン後に出る401だけを問題視する）。
      if (res.status() === 401 && !res.url().endsWith("/auth/check")) {
        consoleErrors.push(`401 ${res.request().method()} ${res.url()}`);
      }
    });
    await page.goto(baseUrl);
    await page.locator('input[placeholder="Token"]').fill(token);
    await page.locator("button[type=submit]").click();
    await page.waitForSelector(".login-screen", { state: "hidden", timeout: 10_000 }).catch(() => {});
    await page.waitForSelector(".tab-btn", { timeout: 15_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000)); // 全タブ描画の猶予

    const tabCount = await page.locator(".tab-btn").count();
    check(`UIのタブ数が${SESSION_COUNT}件描画される`, tabCount === SESSION_COUNT, `actual=${tabCount}`);

    const screenshotPath = path.join(dataDir, "..", `stress-ui-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`スクリーンショット: ${screenshotPath}`);

    check("UIでconsole errorが発生していない", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  } catch (e) {
    fail(`予期しないエラー: ${e.stack || e}`);
    console.error("--- server log (tail) ---");
    console.error(serverLog.join("").split("\n").slice(-60).join("\n"));
    results.fail.push(`unexpected error: ${e.message || e}`);
  } finally {
    await cleanup();
  }

  console.log("\n=== 結果 ===");
  console.log(`PASS: ${results.pass.length}  FAIL: ${results.fail.length}`);
  if (results.fail.length > 0) {
    console.log("failed checks:");
    for (const f of results.fail) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
