import { describe, it, expect } from "vitest";
import { basename, dirname } from "../../ui/utils/path.ts";

describe("basename", () => {
  it("末尾要素を返す", () => {
    expect(basename("src/app.js")).toBe("app.js");
    expect(basename("a/b/c.txt")).toBe("c.txt");
  });

  it("区切りが無ければ全体を返す", () => {
    expect(basename("file.txt")).toBe("file.txt");
  });

  it("ルート直下・末尾スラッシュ・空を扱う", () => {
    expect(basename("/file.txt")).toBe("file.txt");
    expect(basename("dir/")).toBe("");
    expect(basename("")).toBe("");
    expect(basename(null)).toBe("");
    expect(basename(undefined)).toBe("");
  });
});

describe("dirname", () => {
  it("親ディレクトリを返す", () => {
    expect(dirname("src/app.js")).toBe("src");
    expect(dirname("a/b/c.txt")).toBe("a/b");
  });

  it("区切りが無ければ空文字（ルート直下扱い）", () => {
    expect(dirname("file.txt")).toBe("");
  });

  it("ルート直下・空を扱う", () => {
    expect(dirname("/file.txt")).toBe("");
    expect(dirname("")).toBe("");
    expect(dirname(null)).toBe("");
  });
});
