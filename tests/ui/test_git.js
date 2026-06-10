// @ts-check
import { describe, it, expect } from "vitest";
import { parseGitRefs, formatGitTime, parseGitLogEntries, parseDiffNumstatFromChunk, buildNumstatHtml, buildFileNumstatHtml, countContentLines, abbreviateBranch, dirtyBadgeHtml, entryBranches, buildGithubFileUrl } from "../../ui/utils/git.js";

// ── Tests ──

describe("parseGitRefs", () => {
  it("空文字列で空配列", () => {
    expect(parseGitRefs("")).toEqual([]);
  });

  it("nullで空配列", () => {
    expect(parseGitRefs(null)).toEqual([]);
  });

  it("HEAD -> mainをheadタイプでパース", () => {
    const refs = parseGitRefs("HEAD -> main");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("main");
    expect(refs[0].type).toBe("head");
  });

  it("tag: v1.0をtagタイプでパース", () => {
    const refs = parseGitRefs("tag: v1.0");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("v1.0");
    expect(refs[0].type).toBe("tag");
  });

  it("origin/mainをremoteタイプでパース", () => {
    const refs = parseGitRefs("origin/main");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("origin/main");
    expect(refs[0].type).toBe("remote");
    expect(refs[0].icon).toBe("mdi-github");
  });

  it("upstream/mainをremoteタイプ(mdi-server)でパース", () => {
    const refs = parseGitRefs("upstream/main");
    expect(refs.length).toBe(1);
    expect(refs[0].icon).toBe("mdi-server");
  });

  it("通常のブランチ名をbranchタイプでパース", () => {
    const refs = parseGitRefs("develop");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("develop");
    expect(refs[0].type).toBe("branch");
  });

  it("HEADとorigin/HEADはフィルタされる", () => {
    const refs = parseGitRefs("HEAD, HEAD -> main, origin/HEAD");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("main");
  });

  it("ローカルとorigin同名でsynced=trueになりremoteが除去される", () => {
    const refs = parseGitRefs("HEAD -> main, origin/main");
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe("main");
    expect(refs[0].synced).toBe(true);
  });

  it("複数refs（head + tag + remote）の複合パース", () => {
    const refs = parseGitRefs("HEAD -> main, tag: v1.0, origin/develop");
    expect(refs.length).toBe(3);
    expect(refs[0].type).toBe("head");
    expect(refs[1].type).toBe("tag");
    expect(refs[2].type).toBe("remote");
  });

  it("syncedでないremoteブランチは残る", () => {
    const refs = parseGitRefs("HEAD -> main, origin/feature");
    expect(refs.length).toBe(2);
    expect(refs[1].label).toBe("origin/feature");
  });
});

describe("formatGitTime", () => {
  it("空文字列で'-'を返す", () => {
    expect(formatGitTime("")).toBe("-");
  });

  it("nullで'-'を返す", () => {
    expect(formatGitTime(null)).toBe("-");
  });

  it("不正な日付文字列をそのまま返す", () => {
    expect(formatGitTime("invalid")).toBe("invalid");
  });

  it("ISO日付をフォーマットする", () => {
    const result = formatGitTime("2025-03-15T10:30:00");
    expect(result).toBe("2025-03-15 10:30");
  });
});

describe("parseGitLogEntries", () => {
  it("空文字列で空配列", () => {
    expect(parseGitLogEntries("")).toEqual([]);
  });

  it("nullで空配列", () => {
    expect(parseGitLogEntries(null)).toEqual([]);
  });

  it("タブ区切りログ行をパースする", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\t\tcommit message";
    const entries = parseGitLogEntries(line);
    expect(entries.length).toBe(1);
    expect(entries[0].hash).toBe("abc12345");
    expect(entries[0].fullHash).toBe("abc1234567890def");
    expect(entries[0].author).toBe("author");
    expect(entries[0].message).toBe("commit message");
  });

  it("5フィールド未満の行はスキップ", () => {
    const entries = parseGitLogEntries("abc\t123\tauthor");
    expect(entries.length).toBe(0);
  });

  it("複数行をパースする", () => {
    const lines = [
      "aaa1111122222333\t2025-01-01T00:00:00\tAlice\t\tfirst",
      "bbb4444455555666\t2025-01-02T00:00:00\tBob\t\tsecond",
    ].join("\n");
    const entries = parseGitLogEntries(lines);
    expect(entries.length).toBe(2);
    expect(entries[0].message).toBe("first");
    expect(entries[1].message).toBe("second");
  });

  it("refsありの行をパースする", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\tHEAD -> main\tcommit";
    const entries = parseGitLogEntries(line);
    expect(entries[0].refs.length).toBe(1);
    expect(entries[0].refs[0].label).toBe("main");
  });

  it("メッセージにタブが含まれる場合も結合される", () => {
    const line = "abc1234567890def\t2025-03-15T10:30:00\tauthor\t\tpart1\tpart2";
    const entries = parseGitLogEntries(line);
    expect(entries[0].message).toBe("part1\tpart2");
  });
});

describe("parseDiffNumstatFromChunk", () => {
  it("nullでnullを返す", () => {
    expect(parseDiffNumstatFromChunk(null)).toBe(null);
  });

  it("空文字列でnullを返す", () => {
    expect(parseDiffNumstatFromChunk("")).toBe(null);
  });

  it("変更なしのdiffでnullを返す", () => {
    expect(parseDiffNumstatFromChunk("context line\nanother line")).toBe(null);
  });

  it("追加行をカウントする", () => {
    const chunk = "+added line1\n+added line2\ncontext";
    const result = parseDiffNumstatFromChunk(chunk);
    expect(result).toEqual({ insertions: 2, deletions: 0 });
  });

  it("削除行をカウントする", () => {
    const chunk = "-removed line\ncontext";
    const result = parseDiffNumstatFromChunk(chunk);
    expect(result).toEqual({ insertions: 0, deletions: 1 });
  });

  it("+++/---ヘッダーは除外される", () => {
    const chunk = "--- a/file.txt\n+++ b/file.txt\n+added\n-removed";
    const result = parseDiffNumstatFromChunk(chunk);
    expect(result).toEqual({ insertions: 1, deletions: 1 });
  });

  it("追加・削除混在をカウントする", () => {
    const chunk = "+add1\n+add2\n-del1\ncontext\n+add3";
    const result = parseDiffNumstatFromChunk(chunk);
    expect(result).toEqual({ insertions: 3, deletions: 1 });
  });
});

describe("buildNumstatHtml", () => {
  it("両方nullで空文字列", () => {
    expect(buildNumstatHtml(null, null)).toBe("");
  });

  it("追加・削除のHTMLを生成する", () => {
    const html = buildNumstatHtml(3, 2);
    expect(html.includes("+3")).toBeTruthy();
    expect(html.includes("-2")).toBeTruthy();
    expect(html.includes("numstat-added")).toBeTruthy();
    expect(html.includes("numstat-deleted")).toBeTruthy();
  });

  it("omitZeroDeletions=trueで削除0の場合、削除部分を省略", () => {
    const html = buildNumstatHtml(5, 0, { omitZeroDeletions: true });
    expect(html.includes("+5")).toBeTruthy();
    expect(!html.includes("-0")).toBeTruthy();
  });

  it("omitZeroDeletions=trueでも削除があれば表示", () => {
    const html = buildNumstatHtml(5, 3, { omitZeroDeletions: true });
    expect(html.includes("-3")).toBeTruthy();
  });

  it("neutralText=trueでnumstat-neutralクラスを使用", () => {
    const html = buildNumstatHtml(1, 1, { neutralText: true });
    expect(html.includes("numstat-neutral")).toBeTruthy();
    expect(!html.includes("numstat-added")).toBeTruthy();
  });

  it("insertionsのみnullで0として扱う", () => {
    const html = buildNumstatHtml(null, 3);
    expect(html.includes("+0")).toBeTruthy();
    expect(html.includes("-3")).toBeTruthy();
  });
});

describe("countContentLines", () => {
  it("空文字列で0", () => {
    expect(countContentLines("")).toBe(0);
  });

  it("nullで0", () => {
    expect(countContentLines(null)).toBe(0);
  });

  it("1行（改行なし）で1", () => {
    expect(countContentLines("hello")).toBe(1);
  });

  it("1行（改行あり）で1", () => {
    expect(countContentLines("hello\n")).toBe(1);
  });

  it("複数行をカウント", () => {
    expect(countContentLines("a\nb\nc\n")).toBe(3);
  });

  it("末尾改行なしの複数行", () => {
    expect(countContentLines("a\nb\nc")).toBe(3);
  });
});

describe("buildFileNumstatHtml", () => {
  it("insertions/deletionsフィールドを優先する", () => {
    const html = buildFileNumstatHtml({ status: "M", insertions: 5, deletions: 2 });
    expect(html.includes("+5")).toBeTruthy();
    expect(html.includes("-2")).toBeTruthy();
  });

  it("added/deletedエイリアスにも対応する", () => {
    const html = buildFileNumstatHtml({ status: "M", added: 3, deleted: 1 });
    expect(html.includes("+3")).toBeTruthy();
    expect(html.includes("-1")).toBeTruthy();
  });

  it("numstat情報がなければdiffChunkからカウント", () => {
    const chunk = "+line1\n+line2\n-old";
    const html = buildFileNumstatHtml({ status: "M" }, chunk);
    expect(html.includes("+2")).toBeTruthy();
    expect(html.includes("-1")).toBeTruthy();
  });

  it("status=??で削除0の場合omitされる", () => {
    const html = buildFileNumstatHtml({ status: "??", insertions: 10 });
    expect(html.includes("+10")).toBeTruthy();
    expect(!html.includes("-0")).toBeTruthy();
  });

  it("status=Aで削除0の場合omitされる", () => {
    const html = buildFileNumstatHtml({ status: "A", insertions: 7 });
    expect(!html.includes("-0")).toBeTruthy();
  });

  it("numstatもchunkもない場合は空文字列", () => {
    expect(buildFileNumstatHtml({ status: "M" })).toBe("");
  });
});

describe("abbreviateBranch", () => {
  it("スラッシュなしはabbr空、restのみ", () => {
    expect(abbreviateBranch("main")).toEqual({ abbr: "", rest: "main" });
  });
  it("feature/hoge → abbr=f~/, rest=hoge", () => {
    expect(abbreviateBranch("feature/hoge")).toEqual({ abbr: "f~/", rest: "hoge" });
  });
  it("fix/login-bug → abbr=f~/, rest=login-bug", () => {
    expect(abbreviateBranch("fix/login-bug")).toEqual({ abbr: "f~/", rest: "login-bug" });
  });
  it("複数スラッシュは最初のみ省略", () => {
    expect(abbreviateBranch("feature/v2/auth")).toEqual({ abbr: "f~/", rest: "v2/auth" });
  });
  it("空文字列はabbr空、rest空", () => {
    expect(abbreviateBranch("")).toEqual({ abbr: "", rest: "" });
  });
});

describe("entryBranches", () => {
  it("branch/remoteタイプのラベルのみ抽出する", () => {
    const entry = {
      refs: [
        { label: "main", type: "head" },
        { label: "feature/x", type: "branch" },
        { label: "origin/feature/x", type: "remote" },
        { label: "v1.0", type: "tag" },
      ],
    };
    expect(entryBranches(entry)).toEqual(["feature/x", "origin/feature/x"]);
  });

  it("refsが空なら空配列", () => {
    expect(entryBranches({ refs: [] })).toEqual([]);
  });
});

describe("buildGithubFileUrl", () => {
  it("github_url/blob/ref/path 形式のURLを生成する", () => {
    expect(buildGithubFileUrl("https://github.com/u/repo", "main", "src/app.js"))
      .toBe("https://github.com/u/repo/blob/main/src/app.js");
  });

  it("githubUrlが空なら空文字列", () => {
    expect(buildGithubFileUrl("", "main", "src/app.js")).toBe("");
  });

  it("refが空なら空文字列", () => {
    expect(buildGithubFileUrl("https://github.com/u/repo", "", "src/app.js")).toBe("");
  });
});

describe("dirtyBadgeHtml", () => {
  it("undefined/null は 0 として扱う", () => {
    expect(dirtyBadgeHtml(undefined)).toBe('<span class="diff-num-plus">+0</span> <span class="diff-num-del">-0</span>');
    expect(dirtyBadgeHtml(null)).toBe('<span class="diff-num-plus">+0</span> <span class="diff-num-del">-0</span>');
  });
  it("変更ファイルが0件のときはファイル数バッジを含めない", () => {
    expect(dirtyBadgeHtml({ changed_files: 0, insertions: 2, deletions: 1 })).toBe('<span class="diff-num-plus">+2</span> <span class="diff-num-del">-1</span>');
  });
  it("変更ファイル数が1件以上ならFバッジを付与", () => {
    expect(dirtyBadgeHtml({ changed_files: 3, insertions: 10, deletions: 4 })).toBe('<span class="header-git-files">3F</span> <span class="diff-num-plus">+10</span> <span class="diff-num-del">-4</span>');
  });
});
