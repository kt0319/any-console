// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of pure functions from git.js ──

function parseGitRefs(refsStr) {
  if (!refsStr) return [];
  const parsed = refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r) => {
      if (r.startsWith("HEAD -> ")) {
        return { label: r.replace("HEAD -> ", ""), type: "head", icon: "mdi-source-branch" };
      }
      if (r.startsWith("tag: ")) {
        return { label: r.replace("tag: ", ""), type: "tag", icon: "mdi-tag-outline" };
      }
      if (r.startsWith("origin/")) {
        return { label: r, type: "remote", icon: "mdi-github" };
      }
      if (r.startsWith("upstream/")) {
        return { label: r, type: "remote", icon: "mdi-server" };
      }
      return { label: r, type: "branch", icon: "mdi-source-branch" };
    });
  const localBranches = parsed.filter(r => r.type === "head" || r.type === "branch");
  for (const local of localBranches) {
    const remoteIdx = parsed.findIndex(
      r => r.type === "remote" && r.label === "origin/" + local.label
    );
    if (remoteIdx !== -1) {
      local.synced = true;
      parsed.splice(remoteIdx, 1);
    }
  }
  return parsed;
}

function formatGitTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return timeText;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function parseGitLogEntries(stdout) {
  if (!stdout) return [];
  const lines = stdout.trim().split("\n");
  const result = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [hash, time, author, refs, ...msgParts] = parts;
    result.push({
      hash: hash.slice(0, 8),
      fullHash: hash,
      refs: parseGitRefs(refs),
      author,
      time: formatGitTime(time),
      message: msgParts.join("\t"),
    });
  }
  return result;
}

function parseDiffNumstatFromChunk(diffChunk) {
  if (!diffChunk) return null;
  let insertions = 0;
  let deletions = 0;
  let changed = false;
  for (const line of diffChunk.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      insertions += 1;
      changed = true;
    } else if (line.startsWith("-")) {
      deletions += 1;
      changed = true;
    }
  }
  if (!changed) return null;
  return { insertions, deletions };
}

function buildNumstatHtml(insertions, deletions, opts = {}) {
  if (insertions == null && deletions == null) return "";
  const { omitZeroDeletions = false, neutralText = false } = opts;
  const addValue = insertions == null ? 0 : insertions;
  const delValue = deletions == null ? 0 : deletions;
  const addClass = neutralText ? "numstat-neutral" : "numstat-added";
  const delClass = neutralText ? "numstat-neutral" : "numstat-deleted";
  if (omitZeroDeletions && delValue === 0) {
    return `<span class="${addClass}">+${addValue}</span>`;
  }
  return `<span class="${addClass}">+${addValue}</span> <span class="${delClass}">-${delValue}</span>`;
}

function countContentLines(content) {
  const text = String(content || "");
  if (!text) return 0;
  const lines = text.split("\n").length;
  if (text.endsWith("\n")) return Math.max(0, lines - 1);
  return lines;
}

function buildFileNumstatHtml(file, diffChunk = "", opts = {}) {
  const status = String(file.status || "").trim();
  const omitZeroDeletions = status === "??" || status === "A";
  const { neutralText = false } = opts;
  const insertions = file.insertions ?? file.added;
  const deletions = file.deletions ?? file.deleted;
  if (insertions != null || deletions != null) {
    return buildNumstatHtml(insertions, deletions, { omitZeroDeletions, neutralText });
  }
  const parsed = parseDiffNumstatFromChunk(diffChunk);
  return buildNumstatHtml(parsed?.insertions, parsed?.deletions, { omitZeroDeletions, neutralText });
}

// ── Tests ──

describe("parseGitRefs", () => {
  it("空文字列で空配列", () => {
    assert.deepEqual(parseGitRefs(""), []);
  });

  it("nullで空配列", () => {
    assert.deepEqual(parseGitRefs(null), []);
  });

  it("HEAD -> mainをheadタイプでパース", () => {
    const refs = parseGitRefs("HEAD -> main");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "main");
    assert.equal(refs[0].type, "head");
  });

  it("tag: v1.0をtagタイプでパース", () => {
    const refs = parseGitRefs("tag: v1.0");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "v1.0");
    assert.equal(refs[0].type, "tag");
  });

  it("origin/mainをremoteタイプでパース", () => {
    const refs = parseGitRefs("origin/main");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "origin/main");
    assert.equal(refs[0].type, "remote");
    assert.equal(refs[0].icon, "mdi-github");
  });

  it("upstream/mainをremoteタイプ(mdi-server)でパース", () => {
    const refs = parseGitRefs("upstream/main");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].icon, "mdi-server");
  });

  it("通常のブランチ名をbranchタイプでパース", () => {
    const refs = parseGitRefs("develop");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "develop");
    assert.equal(refs[0].type, "branch");
  });

  it("HEADとorigin/HEADはフィルタされる", () => {
    const refs = parseGitRefs("HEAD, HEAD -> main, origin/HEAD");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "main");
  });

  it("ローカルとorigin同名でsynced=trueになりremoteが除去される", () => {
    const refs = parseGitRefs("HEAD -> main, origin/main");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].label, "main");
    assert.equal(refs[0].synced, true);
  });

  it("複数refs（head + tag + remote）の複合パース", () => {
    const refs = parseGitRefs("HEAD -> main, tag: v1.0, origin/develop");
    assert.equal(refs.length, 3);
    assert.equal(refs[0].type, "head");
    assert.equal(refs[1].type, "tag");
    assert.equal(refs[2].type, "remote");
  });

  it("syncedでないremoteブランチは残る", () => {
    const refs = parseGitRefs("HEAD -> main, origin/feature");
    assert.equal(refs.length, 2);
    assert.equal(refs[1].label, "origin/feature");
  });
});

describe("formatGitTime", () => {
  it("空文字列で'-'を返す", () => {
    assert.equal(formatGitTime(""), "-");
  });

  it("nullで'-'を返す", () => {
    assert.equal(formatGitTime(null), "-");
  });

  it("不正な日付文字列をそのまま返す", () => {
    assert.equal(formatGitTime("invalid"), "invalid");
  });

  it("ISO日付をフォーマットする", () => {
    const result = formatGitTime("2025-03-15T10:30:00");
    assert.equal(result, "2025-03-15 10:30");
  });
});

describe("parseGitLogEntries", () => {
  it("空文字列で空配列", () => {
    assert.deepEqual(parseGitLogEntries(""), []);
  });

  it("nullで空配列", () => {
    assert.deepEqual(parseGitLogEntries(null), []);
  });

  it("タブ区切りログ行をパースする", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\t\tcommit message";
    const entries = parseGitLogEntries(line);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].hash, "abc12345");
    assert.equal(entries[0].fullHash, "abc1234567890def");
    assert.equal(entries[0].author, "author");
    assert.equal(entries[0].message, "commit message");
  });

  it("5フィールド未満の行はスキップ", () => {
    const entries = parseGitLogEntries("abc\t123\tauthor");
    assert.equal(entries.length, 0);
  });

  it("複数行をパースする", () => {
    const lines = [
      "aaa1111122222333\t2025-01-01T00:00:00\tAlice\t\tfirst",
      "bbb4444455555666\t2025-01-02T00:00:00\tBob\t\tsecond",
    ].join("\n");
    const entries = parseGitLogEntries(lines);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, "first");
    assert.equal(entries[1].message, "second");
  });

  it("refsありの行をパースする", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\tHEAD -> main\tcommit";
    const entries = parseGitLogEntries(line);
    assert.equal(entries[0].refs.length, 1);
    assert.equal(entries[0].refs[0].label, "main");
  });

  it("メッセージにタブが含まれる場合も結合される", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\t\tpart1\tpart2";
    const entries = parseGitLogEntries(line);
    assert.equal(entries[0].message, "part1\tpart2");
  });
});

describe("parseDiffNumstatFromChunk", () => {
  it("nullでnullを返す", () => {
    assert.equal(parseDiffNumstatFromChunk(null), null);
  });

  it("空文字列でnullを返す", () => {
    assert.equal(parseDiffNumstatFromChunk(""), null);
  });

  it("変更なしのdiffでnullを返す", () => {
    assert.equal(parseDiffNumstatFromChunk("context line\nanother line"), null);
  });

  it("追加行をカウントする", () => {
    const chunk = "+added line1\n+added line2\ncontext";
    const result = parseDiffNumstatFromChunk(chunk);
    assert.deepEqual(result, { insertions: 2, deletions: 0 });
  });

  it("削除行をカウントする", () => {
    const chunk = "-removed line\ncontext";
    const result = parseDiffNumstatFromChunk(chunk);
    assert.deepEqual(result, { insertions: 0, deletions: 1 });
  });

  it("+++/---ヘッダーは除外される", () => {
    const chunk = "--- a/file.txt\n+++ b/file.txt\n+added\n-removed";
    const result = parseDiffNumstatFromChunk(chunk);
    assert.deepEqual(result, { insertions: 1, deletions: 1 });
  });

  it("追加・削除混在をカウントする", () => {
    const chunk = "+add1\n+add2\n-del1\ncontext\n+add3";
    const result = parseDiffNumstatFromChunk(chunk);
    assert.deepEqual(result, { insertions: 3, deletions: 1 });
  });
});

describe("buildNumstatHtml", () => {
  it("両方nullで空文字列", () => {
    assert.equal(buildNumstatHtml(null, null), "");
  });

  it("追加・削除のHTMLを生成する", () => {
    const html = buildNumstatHtml(3, 2);
    assert.ok(html.includes("+3"));
    assert.ok(html.includes("-2"));
    assert.ok(html.includes("numstat-added"));
    assert.ok(html.includes("numstat-deleted"));
  });

  it("omitZeroDeletions=trueで削除0の場合、削除部分を省略", () => {
    const html = buildNumstatHtml(5, 0, { omitZeroDeletions: true });
    assert.ok(html.includes("+5"));
    assert.ok(!html.includes("-0"));
  });

  it("omitZeroDeletions=trueでも削除があれば表示", () => {
    const html = buildNumstatHtml(5, 3, { omitZeroDeletions: true });
    assert.ok(html.includes("-3"));
  });

  it("neutralText=trueでnumstat-neutralクラスを使用", () => {
    const html = buildNumstatHtml(1, 1, { neutralText: true });
    assert.ok(html.includes("numstat-neutral"));
    assert.ok(!html.includes("numstat-added"));
  });

  it("insertionsのみnullで0として扱う", () => {
    const html = buildNumstatHtml(null, 3);
    assert.ok(html.includes("+0"));
    assert.ok(html.includes("-3"));
  });
});

describe("countContentLines", () => {
  it("空文字列で0", () => {
    assert.equal(countContentLines(""), 0);
  });

  it("nullで0", () => {
    assert.equal(countContentLines(null), 0);
  });

  it("1行（改行なし）で1", () => {
    assert.equal(countContentLines("hello"), 1);
  });

  it("1行（改行あり）で1", () => {
    assert.equal(countContentLines("hello\n"), 1);
  });

  it("複数行をカウント", () => {
    assert.equal(countContentLines("a\nb\nc\n"), 3);
  });

  it("末尾改行なしの複数行", () => {
    assert.equal(countContentLines("a\nb\nc"), 3);
  });
});

describe("buildFileNumstatHtml", () => {
  it("insertions/deletionsフィールドを優先する", () => {
    const html = buildFileNumstatHtml({ status: "M", insertions: 5, deletions: 2 });
    assert.ok(html.includes("+5"));
    assert.ok(html.includes("-2"));
  });

  it("added/deletedエイリアスにも対応する", () => {
    const html = buildFileNumstatHtml({ status: "M", added: 3, deleted: 1 });
    assert.ok(html.includes("+3"));
    assert.ok(html.includes("-1"));
  });

  it("numstat情報がなければdiffChunkからカウント", () => {
    const chunk = "+line1\n+line2\n-old";
    const html = buildFileNumstatHtml({ status: "M" }, chunk);
    assert.ok(html.includes("+2"));
    assert.ok(html.includes("-1"));
  });

  it("status=??で削除0の場合omitされる", () => {
    const html = buildFileNumstatHtml({ status: "??", insertions: 10 });
    assert.ok(html.includes("+10"));
    assert.ok(!html.includes("-0"));
  });

  it("status=Aで削除0の場合omitされる", () => {
    const html = buildFileNumstatHtml({ status: "A", insertions: 7 });
    assert.ok(!html.includes("-0"));
  });

  it("numstatもchunkもない場合は空文字列", () => {
    assert.equal(buildFileNumstatHtml({ status: "M" }), "");
  });
});
