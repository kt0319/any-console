// @ts-check
import { describe, it, expect } from "vitest";
import { looksLikeUrl, extractDomain } from "../../ui/utils/icon-url.js";

describe("looksLikeUrl", () => {
  it("http URLを判定", () => {
    expect(looksLikeUrl("http://example.com/")).toBe(true);
  });
  it("https URLを判定", () => {
    expect(looksLikeUrl("https://example.com/")).toBe(true);
  });
  it("スキーム無しでもドメインっぽい文字列を判定", () => {
    expect(looksLikeUrl("example.com")).toBe(true);
    expect(looksLikeUrl("example.co.jp/path")).toBe(true);
  });
  it("ドメインでない単語は否定", () => {
    expect(looksLikeUrl("just-text")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
});

describe("extractDomain", () => {
  it("https URLからhostnameを抽出", () => {
    expect(extractDomain("https://example.com/path?q=1")).toBe("example.com");
  });
  it("http URLからhostnameを抽出", () => {
    expect(extractDomain("http://sub.example.com/")).toBe("sub.example.com");
  });
  it("スキーム無し文字列は先頭セグメントを返す", () => {
    expect(extractDomain("example.com/path")).toBe("example.com");
  });
  it("不正なURLでも例外を投げず入力を返す", () => {
    expect(extractDomain("https://")).toBe("https://");
  });
});
