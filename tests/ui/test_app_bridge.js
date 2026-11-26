// @ts-check
/** emit / on で使われるイベント名がすべて BUS_EVENTS に登録されていることを保証する（追記漏れ・名前ズレをテスト失敗にする）。 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUS_EVENTS } from "../../ui/app-bridge.ts";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");

// emit("x:y") / bridgeEmit("x:y") / on("x:y") の第一引数（文字列リテラル）を拾う。
// 動的な emit(action) などはリテラルでないため対象外（カタログ強制の対象にしない）。
const BUS_CALL_RE = /\b(?:emit|bridgeEmit|on)\(\s*["']([a-zA-Z]+:[a-zA-Z]+)["']/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(js|ts|vue)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function collectUsedEvents() {
  const used = new Map(); // event -> Set(files)
  for (const file of walk(UI_DIR)) {
    const text = readFileSync(file, "utf-8");
    for (const m of text.matchAll(BUS_CALL_RE)) {
      const name = m[1];
      if (!used.has(name)) used.set(name, new Set());
      used.get(name).add(file.replace(UI_DIR + "/", "ui/"));
    }
  }
  return used;
}

describe("BUS_EVENTS catalog", () => {
  it("has no duplicate entries", () => {
    expect(BUS_EVENTS.length).toBe(new Set(BUS_EVENTS).size);
  });

  it("is sorted (keeps the catalog readable and merge-friendly)", () => {
    const sorted = [...BUS_EVENTS].sort();
    expect(BUS_EVENTS).toEqual(sorted);
  });

  it("covers every namespaced event emitted/listened in ui/", () => {
    const known = new Set(BUS_EVENTS);
    const missing = [];
    for (const [name, files] of collectUsedEvents()) {
      if (!known.has(name)) {
        missing.push(`${name} (used in ${[...files].join(", ")})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no unused catalog entries (dead events)", () => {
    // カタログにあるのに emit も on もされないイベントは、購読者の削除漏れか emit の書き忘れ。
    // 動的 emit（circle-keypad プリセット等）は走査に載らないため、ui/ 内に文字列リテラルとして現れれば許容する。
    const used = collectUsedEvents();
    const allText = walk(UI_DIR)
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    const unused = BUS_EVENTS.filter((name) => !used.has(name) && !allText.includes(`"${name}"`));
    expect(unused).toEqual([]);
  });
});
