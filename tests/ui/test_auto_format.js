// @ts-check
import { describe, it, expect } from "vitest";
import { breakAtPunctuation, stripLeadingSpaces, joinWrappedLines, tidyWhitespace, applyFormat } from "../../ui/utils/auto-format.js";

describe("breakAtPunctuation", () => {
  it("句点で改行し、読点はそのまま", () => {
    expect(breakAtPunctuation("あ。い、う")).toBe("あ。\nい、う");
  });

  it("直後が既に改行なら重複させない", () => {
    expect(breakAtPunctuation("あ。\nい")).toBe("あ。\nい");
  });

  it("半角ピリオド+スペースの文末で改行する", () => {
    expect(breakAtPunctuation("End. Next")).toBe("End.\nNext");
  });

  it("文中のピリオドでは改行しない", () => {
    expect(breakAtPunctuation("foo.txt 3.14")).toBe("foo.txt 3.14");
  });
});

describe("stripLeadingSpaces", () => {
  it("各行の先頭スペース/タブを削除する", () => {
    expect(stripLeadingSpaces("  foo\n\tbar\n    baz")).toBe("foo\nbar\nbaz");
  });

  it("行中・行末のスペースは残す", () => {
    expect(stripLeadingSpaces("  a b c  ")).toBe("a b c  ");
  });
});

describe("joinWrappedLines", () => {
  it("文末記号でない折り返しを結合する（CJKはスペース無し）", () => {
    expect(joinWrappedLines("これは途中で\n折り返した文。")).toBe("これは途中で折り返した文。");
  });

  it("英単語の境界はスペースで結合する", () => {
    expect(joinWrappedLines("End of\nsentence here")).toBe("End of sentence here");
  });

  it("文末記号で終わる行は結合しない", () => {
    expect(joinWrappedLines("文。\n次の文")).toBe("文。\n次の文");
  });

  it("空行（段落区切り）は残す", () => {
    expect(joinWrappedLines("para1\n\npara2")).toBe("para1\n\npara2");
  });
});

describe("tidyWhitespace", () => {
  it("行末空白を除去する", () => {
    expect(tidyWhitespace("foo   \nbar\t")).toBe("foo\nbar");
  });

  it("連続空行を2行に圧縮する", () => {
    expect(tidyWhitespace("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("前後の空白/空行を除去する", () => {
    expect(tidyWhitespace("\n\n  hi  \n\n")).toBe("hi");
  });
});

describe("applyFormat", () => {
  it("全オプション off なら原文のまま", () => {
    const src = "今日はMeeting。  \n\n\n次へ";
    expect(applyFormat(src, {})).toBe(src);
    expect(applyFormat(src)).toBe(src);
  });

  it("stripLeading のみ適用", () => {
    expect(applyFormat("  foo\n  bar", { stripLeading: true })).toBe("foo\nbar");
  });

  it("breakLines + tidy を組み合わせる", () => {
    expect(applyFormat("あ。い。", { breakLines: true, tidy: true })).toBe("あ。\nい。");
  });

  it("空文字はそのまま", () => {
    expect(applyFormat("", { tidy: true })).toBe("");
  });
});
